"""Render only our own self-contained picking template, never caller-supplied HTML."""

import os
from urllib.parse import urlsplit


def allowed_image_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname == "cdn.myshoptet.com"
                and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except ValueError:
        return False


def generate_pdf(html):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        launch_options = {"headless": True, "timeout": 20000}
        executable = os.environ.get("WAREHOUSE_PDF_CHROMIUM")
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        try:
            context = browser.new_context(service_workers="block", accept_downloads=False)
            # No sessions, API calls, local files or arbitrary hosts in this browser.
            context.route("**/*", lambda route: route.continue_()
                          if route.request.resource_type == "image" and allowed_image_url(route.request.url)
                          else route.abort())
            page = context.new_page()
            page.set_default_timeout(45000)
            page.set_content(html, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_function("!document.getElementById('print').disabled", timeout=30000)
            page.evaluate("document.fonts.ready")
            missing = page.locator("#rows .no-photo").count()
            pdf = page.pdf(prefer_css_page_size=True, print_background=True)
            if not pdf.startswith(b"%PDF-") or len(pdf) > 32 * 1024 * 1024:
                raise ValueError("Invalid or oversized print PDF")
            return pdf, missing
        finally:
            browser.close()
