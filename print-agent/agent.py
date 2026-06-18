import base64
import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_NAME = "ExpedicePrintAgent"
DEFAULT_CONFIG = {
    "port": 8787,
    "allowedOrigins": [
        "https://expedice-production.up.railway.app",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
    ],
    "printers": {
        "dpdLabel": "Brother QL-1100",
        "packetaLabel": "Brother QL-700",
        "defaultDocument": "",
    },
    "sumatraPath": "",
    "keepPrintedFiles": False,
}


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def config_dir():
    root = os.environ.get("APPDATA") or str(Path.home())
    path = Path(root) / APP_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def deep_merge(base, override):
    merged = dict(base)
    if not isinstance(override, dict):
        return merged
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config():
    path = config_dir() / "config.json"
    if not path.exists():
        path.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        return dict(DEFAULT_CONFIG)
    try:
        return deep_merge(DEFAULT_CONFIG, json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return dict(DEFAULT_CONFIG)


CONFIG = load_config()


def response_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_cors_headers()
    handler.end_headers()
    handler.wfile.write(body)


def list_printers():
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-Printer | Select-Object -ExpandProperty Name",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
        return [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    except Exception:
        return []


def find_sumatra():
    configured = str(CONFIG.get("sumatraPath") or "").strip()
    candidates = [
        configured,
        str(app_dir() / "SumatraPDF.exe"),
        str(app_dir() / "bin" / "SumatraPDF.exe"),
        str(Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "SumatraPDF" / "SumatraPDF.exe"),
        str(Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "SumatraPDF" / "SumatraPDF.exe"),
        shutil.which("SumatraPDF.exe") or "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return ""


def shell_execute_print(path, printer):
    operation = "printto" if printer else "print"
    parameters = f'"{printer}"' if printer else None
    result = ctypes.windll.shell32.ShellExecuteW(None, operation, str(path), parameters, None, 0)
    if result <= 32:
        raise RuntimeError(f"Windows tisk selhal, ShellExecute={result}")


def sumatra_print(path, printer, copies):
    sumatra = find_sumatra()
    if not sumatra:
        return False
    args = [sumatra]
    if printer:
        args += ["-print-to", printer]
    else:
        args += ["-print-to-default"]
    if copies > 1:
        args += ["-print-settings", f"{copies}x"]
    args += ["-silent", str(path)]
    completed = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "SumatraPDF tisk selhal").strip())
    return True


def printer_for(payload):
    printers = CONFIG.get("printers") or {}
    explicit = str(payload.get("printer") or "").strip()
    if explicit:
        return explicit
    print_type = str(payload.get("type") or "default").strip().lower()
    carrier = str(payload.get("carrier") or "").strip().lower()
    if print_type == "carrier_label" and carrier == "dpd":
        return str(printers.get("dpdLabel") or "").strip()
    if print_type == "carrier_label" and carrier in ("packeta", "zasilkovna", "zásilkovna"):
        return str(printers.get("packetaLabel") or "").strip()
    return str(printers.get("defaultDocument") or "").strip()


def print_pdf(payload):
    content = payload.get("contentBase64") or ""
    if not content:
        raise ValueError("Chybí contentBase64 s PDF dokumentem.")
    filename = str(payload.get("filename") or "expedice-print.pdf")
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    copies = int(payload.get("copies") or 1)
    if copies < 1:
        copies = 1
    if copies > 10:
        copies = 10

    data = base64.b64decode(content)
    temp_root = Path(tempfile.gettempdir()) / APP_NAME
    temp_root.mkdir(parents=True, exist_ok=True)
    target = temp_root / Path(filename).name
    target.write_bytes(data)

    printer = printer_for(payload)
    printed_by = "sumatra" if sumatra_print(target, printer, copies) else "windows-shell"
    if printed_by == "windows-shell":
        shell_execute_print(target, printer)

    if not CONFIG.get("keepPrintedFiles"):
        try:
            target.unlink(missing_ok=True)
        except Exception:
            pass

    return {
        "printer": printer or "Windows default",
        "printedBy": printed_by,
        "copies": copies,
        "filename": filename,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ExpedicePrintAgent/0.1"

    def log_message(self, fmt, *args):
        return

    def origin_allowed(self):
        origin = self.headers.get("Origin", "")
        if not origin:
            return ""
        allowed = CONFIG.get("allowedOrigins") or []
        if origin in allowed or "*" in allowed:
            return origin
        return ""

    def send_cors_headers(self):
        origin = self.origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Print-Agent-Token")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            response_json(
                self,
                200,
                {
                    "ok": True,
                    "name": APP_NAME,
                    "version": "0.1",
                    "sumatraAvailable": bool(find_sumatra()),
                    "config": {
                        "printers": CONFIG.get("printers") or {},
                    },
                },
            )
            return
        if self.path.startswith("/printers"):
            response_json(self, 200, {"ok": True, "printers": list_printers()})
            return
        response_json(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self.path.startswith("/print"):
            response_json(self, 404, {"ok": False, "error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            result = print_pdf(payload)
            response_json(self, 200, {"ok": True, **result})
        except Exception as exc:
            response_json(self, 400, {"ok": False, "error": str(exc)})


def main():
    port = int(CONFIG.get("port") or 8787)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"{APP_NAME} běží na http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
