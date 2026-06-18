import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


APP_NAME = "ExpedicePrintAgent"
AGENT_EXE_NAME = "ExpedicePrintAgent.exe"
SUMATRA_EXE_NAME = "SumatraPDF.exe"
VERSION = "1.0.0"
CREATE_NO_WINDOW = 0x08000000


def base_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def local_appdata() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))


def roaming_appdata() -> Path:
    return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))


def startup_dir() -> Path:
    return roaming_appdata() / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def resource_path(*parts: str) -> Path | None:
    candidates = [
        base_dir().joinpath(*parts),
        Path(__file__).resolve().parent.joinpath(*parts),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


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


def stop_existing_agent() -> None:
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
        return
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) < 5:
            continue
        local_address = columns[1]
        state = columns[3].upper()
        pid = columns[4]
        if local_address.endswith(":8787") and state == "LISTENING" and pid.isdigit():
            run_quiet(["taskkill.exe", "/F", "/PID", pid])


def vbs_string(value: Path | str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def create_shortcut(shortcut_path: Path, target_path: Path, working_dir: Path) -> None:
    shortcut_path.parent.mkdir(parents=True, exist_ok=True)
    script = "\n".join(
        [
            'Set shell = CreateObject("WScript.Shell")',
            f"Set link = shell.CreateShortcut({vbs_string(shortcut_path)})",
            f"link.TargetPath = {vbs_string(target_path)}",
            f"link.WorkingDirectory = {vbs_string(working_dir)}",
            'link.WindowStyle = 7',
            'link.Description = "Expedice Print Agent"',
            "link.Save",
        ]
    )
    with tempfile.NamedTemporaryFile("w", suffix=".vbs", delete=False, encoding="utf-8") as handle:
        handle.write(script)
        script_path = Path(handle.name)
    try:
        subprocess.run(
            ["cscript.exe", "//nologo", str(script_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
            check=True,
        )
    finally:
        script_path.unlink(missing_ok=True)


def install_agent() -> None:
    install_dir = local_appdata() / APP_NAME
    bin_dir = install_dir / "bin"
    shortcut_path = startup_dir() / f"{APP_NAME}.lnk"

    stop_existing_agent()

    install_dir.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)

    bundled_agent = resource_path(AGENT_EXE_NAME)
    source_agent_py = resource_path("agent.py")
    agent_target = install_dir / AGENT_EXE_NAME
    run_target = agent_target

    if bundled_agent:
        shutil.copy2(bundled_agent, agent_target)
    elif source_agent_py:
        shutil.copy2(source_agent_py, install_dir / "agent.py")
        run_bat = install_dir / "run-agent.bat"
        run_bat.write_text(
            f'@echo off\r\ncd /d "{install_dir}"\r\npy -3 agent.py\r\n',
            encoding="ascii",
        )
        run_target = run_bat
    else:
        raise RuntimeError("V balicku chybi ExpedicePrintAgent.exe nebo agent.py.")

    bundled_sumatra = resource_path(SUMATRA_EXE_NAME) or resource_path("bin", SUMATRA_EXE_NAME)
    if bundled_sumatra:
        shutil.copy2(bundled_sumatra, bin_dir / SUMATRA_EXE_NAME)

    (install_dir / "INSTALLATION.txt").write_text(
        "\r\n".join(
            [
                "Expedice Print Agent",
                f"Version: {VERSION}",
                f"Installed to: {install_dir}",
                "Health check: http://127.0.0.1:8787/health",
                "Uninstall with ExpedicePrintAgentUninstall.exe.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    create_shortcut(shortcut_path, run_target, install_dir)
    command = [str(run_target)]
    if run_target.suffix.lower() == ".bat":
        command = ["cmd.exe", "/c", str(run_target)]

    subprocess.Popen(
        command,
        cwd=str(install_dir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW,
    )

    sumatra_note = "SumatraPDF je pribalena." if bundled_sumatra else "SumatraPDF nebyla v balicku nalezena."
    show_message(
        "Expedice Print Agent",
        "Instalace je hotova.\n\n"
        f"Agent je nainstalovan zde:\n{install_dir}\n\n"
        f"{sumatra_note}\n"
        "Po startu Windows se spusti automaticky.",
    )


def main() -> int:
    try:
        install_agent()
        return 0
    except Exception as exc:
        show_message("Expedice Print Agent - chyba instalace", str(exc), error=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
