import ctypes
import os
import shutil
import subprocess
import sys
from pathlib import Path


APP_NAME = "ExpedicePrintAgent"
AGENT_EXE_NAME = "ExpedicePrintAgent.exe"
CREATE_NO_WINDOW = 0x08000000


def local_appdata() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))


def roaming_appdata() -> Path:
    return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))


def startup_dir() -> Path:
    return roaming_appdata() / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def show_message(title: str, text: str, error: bool = False) -> None:
    flags = 0x10 if error else 0x40
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    except Exception:
        print(f"{title}: {text}")


def run_quiet(command: list[str]) -> None:
    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW,
        check=False,
    )


def uninstall_agent(keep_config: bool = False) -> None:
    install_dir = local_appdata() / APP_NAME
    config_dir = roaming_appdata() / APP_NAME
    shortcut_path = startup_dir() / f"{APP_NAME}.lnk"

    run_quiet(["taskkill.exe", "/F", "/T", "/IM", AGENT_EXE_NAME])
    try:
        result = subprocess.run(
            ["netstat.exe", "-ano", "-p", "tcp"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            creationflags=CREATE_NO_WINDOW,
            check=False,
        )
    except Exception:
        result = None
    if result:
        for line in result.stdout.splitlines():
            columns = line.split()
            if len(columns) < 5:
                continue
            local_address = columns[1]
            state = columns[3].upper()
            pid = columns[4]
            if local_address.endswith(":8787") and state == "LISTENING" and pid.isdigit():
                run_quiet(["taskkill.exe", "/F", "/PID", pid])

    if shortcut_path.exists():
        shortcut_path.unlink()

    if install_dir.exists():
        shutil.rmtree(install_dir, ignore_errors=True)

    if not keep_config and config_dir.exists():
        shutil.rmtree(config_dir, ignore_errors=True)

    kept = "\nKonfigurace tiskaren byla ponechana." if keep_config else ""
    show_message("Expedice Print Agent", f"Odinstalace je hotova.{kept}")


def main() -> int:
    keep_config = "--keep-config" in {arg.lower() for arg in sys.argv[1:]}
    try:
        uninstall_agent(keep_config=keep_config)
        return 0
    except Exception as exc:
        show_message("Expedice Print Agent - chyba odinstalace", str(exc), error=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
