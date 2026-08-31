"""إعدادات الأداة: تُحفظ في ملف config.json بجانب البرنامج."""
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")

DEFAULTS = {
    "llm_backend": "ollama",  # "ollama" أو "local" (نموذج GGUF عبر llama-cpp-python)
    "ollama_host": "http://localhost:11434",
    "ollama_model": "",
    "local_models_folder": "",
    "archive_folder": "",
    "template_path": "",
    "dept_archive_folder": "",
    "dept_template_path": "",
}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            cfg = DEFAULTS.copy()
            cfg.update(data)
            return cfg
        except (json.JSONDecodeError, OSError):
            pass
    return DEFAULTS.copy()


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
