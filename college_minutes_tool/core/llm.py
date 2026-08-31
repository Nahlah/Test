"""واجهة موحّدة للتوليد النصي، تدعم محرّكين محليّين بالكامل (بدون إنترنت أثناء العمل):
- "ollama": خادم Ollama المحلي (يتطلب تطبيق Ollama وتشغيله).
- "local": نموذج GGUF يُشغَّل مباشرة داخل بايثون عبر llama-cpp-python (لا يتطلب أي برنامج
  خارجي، ويعمل بأي إصدار من نظام التشغيل).
"""
from .ollama_client import generate as _ollama_generate, list_models as _ollama_list_models, OllamaError
from .local_llm import generate as _local_generate, list_models as _local_list_models, LocalLLMError


class LLMError(Exception):
    pass


def list_models(backend: str, host: str, models_folder: str) -> list:
    try:
        if backend == "local":
            return _local_list_models(models_folder)
        return _ollama_list_models(host)
    except (OllamaError, LocalLLMError) as e:
        raise LLMError(str(e)) from e


def generate(backend: str, host: str, model: str, models_folder: str, prompt: str, system: str = "") -> str:
    try:
        if backend == "local":
            return _local_generate(models_folder, model, prompt, system=system)
        return _ollama_generate(host, model, prompt, system=system)
    except (OllamaError, LocalLLMError) as e:
        raise LLMError(str(e)) from e
