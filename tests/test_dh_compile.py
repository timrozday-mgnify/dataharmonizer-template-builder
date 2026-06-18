import subprocess
import sys

from dataharmonizer_template_builder import dh_compile


def test_compile_schema_uses_backend_python(monkeypatch, tmp_path) -> None:
    dataharmonizer = tmp_path / "DataHarmonizer"
    compiler = dataharmonizer / "script" / "linkml.py"
    compiler.parent.mkdir(parents=True)
    compiler.write_text("print('ok')\n", encoding="utf-8")
    monkeypatch.setenv("DATAHARMONIZER_DIR", str(dataharmonizer))

    commands = []

    def fake_run(command, cwd, check, capture_output, text):
        del cwd, check, capture_output, text
        commands.append(command)
        raise subprocess.CalledProcessError(1, command, stderr="stop")

    monkeypatch.setattr(subprocess, "run", fake_run)

    _, diagnostics = dh_compile.compile_schema_json("name: test\n")

    assert commands[0][0] == sys.executable
    assert diagnostics
