"""Render only our own self-contained picking template, never caller-supplied HTML."""

import asyncio
from io import BytesIO
import os
from urllib.parse import urlsplit

from PIL import Image, ImageOps


def allowed_image_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname == "cdn.myshoptet.com"
                and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except ValueError:
        return False


def thumbnail_jpeg(content):
    if len(content) > 16 * 1024 * 1024:
        raise ValueError("Oversized product photo")
    with Image.open(BytesIO(content)) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError("Oversized product photo dimensions")
        source = ImageOps.exif_transpose(source)
        source.thumbnail((400, 400), Image.Resampling.LANCZOS)
        rgba = source.convert("RGBA")
        thumbnail = Image.new("RGB", rgba.size, "white")
        thumbnail.paste(rgba, mask=rgba.getchannel("A"))
        output = BytesIO()
        thumbnail.save(output, format="JPEG", quality=85)
        return output.getvalue()


def generate_pdf(html):
    return asyncio.run(_generate_pdf(html))


async def _generate_pdf(html):
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        launch_options = {"headless": True, "timeout": 20000}
        executable = os.environ.get("WAREHOUSE_PDF_CHROMIUM")
        if executable:
            launch_options["executable_path"] = executable
        browser = await playwright.chromium.launch(**launch_options)
        try:
            context = await browser.new_context(service_workers="block", accept_downloads=False)
            downloads = asyncio.Semaphore(6)

            async def image_route(route):
                if route.request.resource_type != "image" or not allowed_image_url(route.request.url):
                    await route.abort()
                    return
                response = None
                try:
                    async with downloads:
                        # Redirects must not turn the CDN allowlist into access to another host.
                        response = await route.fetch(timeout=12000, max_redirects=0)
                        if response.status != 200:
                            raise ValueError("Product photo unavailable")
                        content = thumbnail_jpeg(await response.body())
                    await route.fulfill(status=200, content_type="image/jpeg", body=content)
                except Exception:
                    try:
                        await route.abort()
                    except Exception:
                        pass  # The renderer may already have closed after its image deadline.
                finally:
                    if response is not None:
                        await response.dispose()

            # No sessions, API calls, local files or arbitrary hosts in this browser.
            await context.route("**/*", image_route)
            page = await context.new_page()
            page.set_default_timeout(45000)
            await page.set_content(html, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_function("!document.getElementById('print').disabled", timeout=30000)
            await page.evaluate("document.fonts.ready")
            missing = await page.locator("#rows .no-photo").count()
            pdf = await page.pdf(prefer_css_page_size=True, print_background=True)
            if not pdf.startswith(b"%PDF-") or len(pdf) > 32 * 1024 * 1024:
                raise ValueError("Invalid or oversized print PDF")
            return pdf, missing
        finally:
            await browser.close()
