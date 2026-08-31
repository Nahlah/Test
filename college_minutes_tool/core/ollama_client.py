"""اتصال بخادم Ollama المحلي (لا يخرج عن جهاز المستخدم) لصياغة نصوص المحضر."""
import json

import requests


class OllamaError(Exception):
    pass


def list_models(host: str) -> list:
    try:
        resp = requests.get(f"{host.rstrip('/')}/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return [m.get("name", "") for m in data.get("models", [])]
    except requests.RequestException as e:
        raise OllamaError(f"تعذّر الاتصال بخادم Ollama على {host}: {e}") from e


def generate(host: str, model: str, prompt: str, system: str = "", timeout: int = 300) -> str:
    """يستدعي /api/chat على خادم Ollama المحلي ويرجع نص الرد الكامل (بدون بث)."""
    if not model:
        raise OllamaError("لم يتم اختيار نموذج ذكاء اصطناعي محلي (Ollama).")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        resp = requests.post(
            f"{host.rstrip('/')}/api/chat",
            json={"model": model, "messages": messages, "stream": False},
            timeout=timeout,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        raise OllamaError(
            f"تعذّر الاتصال بخادم Ollama على {host}. تأكد من تشغيل Ollama محليًا "
            f"(ollama serve) ووجود النموذج '{model}'.\n{e}"
        ) from e
    try:
        data = resp.json()
        return data["message"]["content"]
    except (json.JSONDecodeError, KeyError) as e:
        raise OllamaError(f"رد غير متوقع من Ollama: {e}") from e
