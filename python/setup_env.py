#!/usr/bin/env python3
"""
Cross-platform Python environment setup for AI Voice Bot.
Automatically detects OS → creates venv → installs dependencies.

Usage:
    python setup_env.py check     # Check environment status
    python setup_env.py setup     # Full setup (venv + install)
    python setup_env.py install   # Install requirements only (venv must exist)
"""

import os
import sys
import json
import shutil
import platform
import subprocess
import venv
from pathlib import Path


# Project root (one level up from python/)
PROJECT_ROOT = Path(__file__).parent.parent.absolute()


SCRIPT_DIR = Path(__file__).parent.absolute()
VENV_DIR = SCRIPT_DIR / "venv"
REQUIREMENTS_FILE = SCRIPT_DIR / "requirements.txt"
F5_TTS_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese"


def get_platform_info():
    """Detect OS and return platform-specific paths."""
    system = platform.system()  # Linux, Darwin, Windows
    arch = platform.machine()   # x86_64, arm64, AMD64

    if system == "Windows":
        python_path = VENV_DIR / "Scripts" / "python.exe"
        pip_path = VENV_DIR / "Scripts" / "pip.exe"
        cli_path = VENV_DIR / "Scripts" / "f5-tts_infer-cli.exe"
    else:
        # Linux and macOS
        python_path = VENV_DIR / "bin" / "python"
        pip_path = VENV_DIR / "bin" / "pip"
        cli_path = VENV_DIR / "bin" / "f5-tts_infer-cli"

    return {
        "system": system,
        "arch": arch,
        "python_version": platform.python_version(),
        "venv_python": str(python_path),
        "venv_pip": str(pip_path),
        "cli_path": str(cli_path),
    }


def find_system_python():
    """Find a suitable system Python (3.10+)."""
    candidates = ["python3", "python"] if platform.system() != "Windows" else ["python", "python3", "py"]

    for cmd in candidates:
        exe = shutil.which(cmd)
        if exe:
            try:
                result = subprocess.run(
                    [exe, "--version"],
                    capture_output=True, text=True, timeout=10
                )
                version_str = result.stdout.strip().split()[-1]
                major, minor = map(int, version_str.split(".")[:2])
                if major == 3 and minor >= 12:
                    return exe, version_str
            except Exception:
                continue

    return None, None


def emit(event_type, **kwargs):
    """Print a JSON event line for Electron to parse."""
    data = {"event": event_type, **kwargs}
    print(json.dumps(data, ensure_ascii=False), flush=True)


def check_nodejs_whisper():
    """Check if nodejs-whisper is installed in the Node.js project."""
    try:
        npm_cmd = "npm.cmd" if platform.system() == "Windows" else "npm"
        result = subprocess.run(
            [npm_cmd, "list", "nodejs-whisper", "--json"],
            capture_output=True, text=True, timeout=15,
            cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            deps = data.get("dependencies", {})
            return "nodejs-whisper" in deps
        return False
    except Exception:
        # Fallback: check if the package directory exists
        whisper_dir = PROJECT_ROOT / "node_modules" / "nodejs-whisper"
        return whisper_dir.exists()


def check_env():
    """Check the current environment status."""
    info = get_platform_info()
    sys_python, sys_version = find_system_python()

    venv_exists = VENV_DIR.exists() and Path(info["venv_python"]).exists()
    requirements_exist = REQUIREMENTS_FILE.exists()
    f5_tts_cloned = F5_TTS_DIR.exists()

    # Check installed packages if venv exists
    installed_packages = []
    whisper_installed = check_nodejs_whisper()  # Whisper is handled by nodejs-whisper (Node.js)
    torch_installed = False
    f5_tts_installed = False
    cli_available = Path(info["cli_path"]).exists()

    if venv_exists:
        try:
            result = subprocess.run(
                [info["venv_python"], "-m", "pip", "list", "--format=json"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                packages = json.loads(result.stdout)
                installed_packages = [p["name"].lower() for p in packages]
                torch_installed = "torch" in installed_packages
                f5_tts_installed = "f5-tts" in installed_packages or any("f5" in p for p in installed_packages)
        except Exception:
            pass

    ready = venv_exists and torch_installed

    emit("check_result",
         platform=info,
         system_python=sys_python,
         system_python_version=sys_version,
         venv_exists=venv_exists,
         venv_python=info["venv_python"],
         requirements_exist=requirements_exist,
         f5_tts_cloned=f5_tts_cloned,
         f5_tts_installed=f5_tts_installed,
         cli_available=cli_available,
         whisper_installed=whisper_installed,
         torch_installed=torch_installed,
         installed_count=len(installed_packages),
         ready=ready)


def create_venv():
    """Create Python virtual environment."""
    if VENV_DIR.exists():
        emit("step", step="venv_exists", message="Virtual environment already exists")
        return True

    emit("step", step="creating_venv", message="Creating virtual environment...")

    sys_python, sys_version = find_system_python()
    if not sys_python:
        emit("error", step="creating_venv", message="Python 3.10+ not found on system")
        return False

    try:
        # Use subprocess to call venv module with the found python
        result = subprocess.run(
            [sys_python, "-m", "venv", str(VENV_DIR)],
            capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0:
            emit("error", step="creating_venv", message=f"Failed to create venv: {result.stderr}")
            return False

        emit("step", step="venv_created", message=f"Virtual environment created with Python {sys_version}")
        return True
    except Exception as e:
        emit("error", step="creating_venv", message=str(e))
        return False


def upgrade_pip():
    """Upgrade pip in the venv."""
    info = get_platform_info()
    emit("step", step="upgrading_pip", message="Upgrading pip...")

    try:
        result = subprocess.run(
            [info["venv_python"], "-m", "pip", "install", "--upgrade", "pip"],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            emit("step", step="pip_upgraded", message="pip upgraded successfully")
        return result.returncode == 0
    except Exception as e:
        emit("error", step="upgrading_pip", message=str(e))
        return False


def install_requirements():
    """Install packages from requirements.txt."""
    info = get_platform_info()

    if not REQUIREMENTS_FILE.exists():
        emit("error", step="install_requirements", message="requirements.txt not found")
        return False

    emit("step", step="installing_requirements", message="Installing Python packages (this may take several minutes)...")

    try:
        result = subprocess.run(
            [info["venv_python"], "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)],
            capture_output=True, text=True, timeout=1800  # 30 min timeout for torch etc.
        )

        if result.returncode != 0:
            emit("error", step="install_requirements", message=f"pip install failed: {result.stderr[-500:]}")
            return False

        emit("step", step="requirements_installed", message="Python packages installed successfully")
        return True
    except subprocess.TimeoutExpired:
        emit("error", step="install_requirements", message="Installation timed out (>30 min)")
        return False
    except Exception as e:
        emit("error", step="install_requirements", message=str(e))
        return False


def install_f5_tts():
    """Install F5-TTS Vietnamese from local clone."""
    info = get_platform_info()

    if not F5_TTS_DIR.exists():
        emit("step", step="f5_tts_skip", message="F5-TTS-Vietnamese not cloned yet, skipping")
        return True  # Not a failure, just skip

    emit("step", step="installing_f5_tts", message="Installing F5-TTS Vietnamese...")

    try:
        result = subprocess.run(
            [info["venv_python"], "-m", "pip", "install", "-e", str(F5_TTS_DIR)],
            capture_output=True, text=True, timeout=600
        )

        if result.returncode != 0:
            emit("error", step="install_f5_tts", message=f"F5-TTS install failed: {result.stderr[-500:]}")
            return False

        emit("step", step="f5_tts_installed", message="F5-TTS Vietnamese installed successfully")
        return True
    except Exception as e:
        emit("error", step="install_f5_tts", message=str(e))
        return False


def full_setup():
    """Run full setup: venv → pip upgrade → requirements → F5-TTS."""
    emit("step", step="setup_start", message="Starting full Python environment setup...")

    total_steps = 4
    current = 0

    # Step 1: Create venv
    current += 1
    emit("progress", current=current, total=total_steps, percent=int(current / total_steps * 100))
    if not create_venv():
        emit("complete", success=False, message="Failed to create virtual environment")
        return

    # Step 2: Upgrade pip
    current += 1
    emit("progress", current=current, total=total_steps, percent=int(current / total_steps * 100))
    upgrade_pip()  # Non-critical, continue even if fails

    # Step 3: Install requirements
    current += 1
    emit("progress", current=current, total=total_steps, percent=int(current / total_steps * 100))
    if not install_requirements():
        emit("complete", success=False, message="Failed to install Python packages")
        return

    # Step 4: Install F5-TTS
    current += 1
    emit("progress", current=current, total=total_steps, percent=int(current / total_steps * 100))
    install_f5_tts()  # Non-critical

    emit("complete", success=True, message="Python environment setup completed!")


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python setup_env.py <check|setup|install>"}))
        sys.exit(1)

    command = sys.argv[1]

    if command == "check":
        check_env()
    elif command == "setup":
        full_setup()
    elif command == "install":
        install_requirements()
        install_f5_tts()
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
