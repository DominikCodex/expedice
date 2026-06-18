import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


SOURCE_DIR = Path(__file__).resolve().parent
SUMATRA_VERSION = "3.6.1"
SUMATRA_ZIP_URL = (
    f"https://www.sumatrapdfreader.org/dl/rel/{SUMATRA_VERSION}/"
    f"SumatraPDF-{SUMATRA_VERSION}-64.zip"
)


def run(command: list[str]) -> None:
    print("+ " + " ".join(command))
    subprocess.run(command, cwd=SOURCE_DIR, check=True)


def prepare_sumatra() -> Path:
    bin_dir = SOURCE_DIR / "bin"
    bin_dir.mkdir(exist_ok=True)
    target = bin_dir / "SumatraPDF.exe"
    if target.exists():
        return target

    temp_zip = SOURCE_DIR / f"SumatraPDF-{SUMATRA_VERSION}-64.zip"
    temp_dir = SOURCE_DIR / f"SumatraPDF-{SUMATRA_VERSION}-64"
    print("Downloading SumatraPDF portable...")
    request = urllib.request.Request(
        SUMATRA_ZIP_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        temp_zip.write_bytes(response.read())

    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir()

    with zipfile.ZipFile(temp_zip) as archive:
        archive.extractall(temp_dir)

    candidates = list(temp_dir.rglob("SumatraPDF*.exe"))
    if not candidates:
        raise RuntimeError("SumatraPDF.exe was not found in downloaded archive.")

    shutil.copy2(candidates[0], target)
    return target


def main() -> int:
    sumatra_target = prepare_sumatra()

    run([sys.executable, "-m", "pip", "install", "--upgrade", "pyinstaller"])
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--onefile",
            "--noconsole",
            "--clean",
            "--name",
            "ExpedicePrintAgent",
            "agent.py",
        ]
    )
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--onefile",
            "--noconsole",
            "--clean",
            "--name",
            "ExpedicePrintAgentSetup",
            "--add-data",
            f"{SOURCE_DIR / 'dist' / 'ExpedicePrintAgent.exe'};.",
            "--add-data",
            f"{sumatra_target};.",
            "installer.py",
        ]
    )
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--onefile",
            "--noconsole",
            "--clean",
            "--name",
            "ExpedicePrintAgentUninstall",
            "uninstaller.py",
        ]
    )

    shutil.copy2(
        SOURCE_DIR / "dist" / "ExpedicePrintAgentSetup.exe",
        SOURCE_DIR / "ExpedicePrintAgentSetup.exe",
    )
    shutil.copy2(
        SOURCE_DIR / "dist" / "ExpedicePrintAgentUninstall.exe",
        SOURCE_DIR / "ExpedicePrintAgentUninstall.exe",
    )

    print(f"Agent: {SOURCE_DIR / 'dist' / 'ExpedicePrintAgent.exe'}")
    print(f"Installer: {SOURCE_DIR / 'ExpedicePrintAgentSetup.exe'}")
    print(f"Uninstaller: {SOURCE_DIR / 'ExpedicePrintAgentUninstall.exe'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
