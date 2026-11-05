"""Read-only tools constructed exclusively from the accepted turn snapshot."""

import math
import operator
import os
import stat
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import PurePosixPath, PureWindowsPath

from camel.toolkits import FunctionTool

from app.service import skill_service
from app.session_agents.skills import SkillUnavailable, resolve_skills

_MAX_REFERENCE = 64 * 1024


def _windows_handle_path(file) -> str:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    get_path = ctypes.WinDLL(
        "kernel32", use_last_error=True
    ).GetFinalPathNameByHandleW
    get_path.argtypes = [
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    get_path.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_path(
        msvcrt.get_osfhandle(file.fileno()), buffer, len(buffer), 0
    )
    if not 0 < length < len(buffer):
        raise OSError("Cannot verify skill reference handle")
    value = buffer.value
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    return value.removeprefix("\\\\?\\")


def _read_windows_reference(skill_id: str, path: str) -> bytes:
    # Compare the *opened handle* to the selected physical package, not
    # to a second resolution of a replaceable directory link or junction.
    expected = skill_service.SKILLS_ROOT.resolve() / skill_id / path
    permitted = skill_service.skill_file_path(skill_id, path)
    with permitted.open("rb") as file:
        if not stat.S_ISREG(
            os.fstat(file.fileno()).st_mode
        ) or os.path.normcase(_windows_handle_path(file)) != os.path.normcase(
            str(expected)
        ):
            raise PermissionError("Reference is outside the selected package")
        return file.read(_MAX_REFERENCE + 1)


def _read_reference(skill_id: str, path: str) -> str:
    parts = path.split("/")
    if (
        not parts
        or len(parts) > 32
        or any(not part or part.startswith(".") for part in parts)
        or any(
            ":" in part or PureWindowsPath(part).is_reserved()
            for part in parts
        )
        or "\\" in path
        or "\x00" in path
        or PurePosixPath(path).suffix.lower() not in {".md", ".txt"}
    ):
        raise ValueError("Expected a relative Markdown or text document path")
    if os.open not in os.supports_dir_fd:
        if os.name != "nt":
            raise PermissionError(
                "Cannot verify reference path on this platform"
            )
        raw = _read_windows_reference(skill_id, path)
    else:
        # Pin each directory while opening the next component so symlink swaps
        # cannot redirect the open after a containment check.
        with ExitStack() as stack:
            directory = os.open(
                skill_service.SKILLS_ROOT, os.O_RDONLY | os.O_DIRECTORY
            )
            stack.callback(os.close, directory)
            for component in [skill_id, *parts[:-1]]:
                directory = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=directory,
                )
                stack.callback(os.close, directory)
            fd = os.open(
                parts[-1],
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=directory,
            )
            with os.fdopen(fd, "rb") as file:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError("Expected a regular document")
                raw = file.read(_MAX_REFERENCE + 1)
    if len(raw) > _MAX_REFERENCE:
        raise ValueError("Document exceeds 64 KiB")
    return raw.decode("utf-8")


def build_node_tools(node):
    granted = node.get("granted_tools", [])
    if not granted:
        return []

    def utc_time() -> str:
        """Get the current UTC date and time in ISO 8601 format."""
        node["admit_tool"]("utc_time")
        return datetime.now(UTC).isoformat(timespec="seconds")

    def calculate(operation: str, first: float, second: float) -> str:
        """Calculate a binary arithmetic operation.

        Args:
            operation: One of add, subtract, multiply, divide.
            first: First operand.
            second: Second operand.
        """
        node["admit_tool"]("calculate")
        operations = {
            "add": operator.add,
            "subtract": operator.sub,
            "multiply": operator.mul,
            "divide": operator.truediv,
        }
        if operation not in operations or not all(
            map(math.isfinite, (first, second))
        ):
            return "Invalid operation or operands."
        if operation == "divide" and second == 0:
            return "Cannot divide by zero."
        result = operations[operation](first, second)
        return (
            str(result)
            if math.isfinite(result)
            else "Result exceeds numeric range."
        )

    def read_skill_reference(skill_id: str, path: str) -> str:
        """Read a Markdown or plain text reference from a selected skill.

        Args:
            skill_id: The selected skill package ID.
            path: A document path relative to the skill package.
        """
        node["admit_tool"]("read_skill_reference")
        if skill_id not in node.get("skill_ids", []):
            return "This skill was not selected."
        try:
            resolve_skills(node["tool_owner"], [skill_id])
            return _read_reference(skill_id, path)
        except (SkillUnavailable, OSError, ValueError):
            return "Reference unavailable. Check the skill, file type, path and size."

    registry = {
        f.__name__: f for f in (calculate, utc_time, read_skill_reference)
    }
    return [FunctionTool(registry[key]) for key in granted]
