"""تشغيل نموذج لغوي محلي مباشرة داخل بايثون عبر llama-cpp-python، دون الحاجة لأي برنامج
خادم منفصل (لا Ollama ولا Docker) — بديل يتفادى قيود إصدار نظام التشغيل التي تفرضها
تطبيقات مثل Ollama Desktop و Docker Desktop على أجهزة macOS الأقدم.
"""
import glob
import os

_loaded = {"path": None, "llm": None}


class LocalLLMError(Exception):
    pass


def list_models(models_folder: str) -> list:
    """يرجع أسماء ملفات GGUF الموجودة في المجلد المحدد."""
    if not models_folder or not os.path.isdir(models_folder):
        return []
    return sorted(os.path.basename(p) for p in glob.glob(os.path.join(models_folder, "*.gguf")))


def _get_llm(model_path: str, n_ctx: int = 8192):
    if _loaded["path"] == model_path and _loaded["llm"] is not None:
        return _loaded["llm"]
    try:
        from llama_cpp import Llama
    except ImportError as e:
        raise LocalLLMError(
            "مكتبة llama-cpp-python غير مثبّتة بعد. ثبّتها عبر:\npip3 install llama-cpp-python"
        ) from e
    # n_gpu_layers=0 يعطّل تسريع Metal ويشغّل النموذج على المعالج (CPU) فقط.
    # تسريع Metal (n_gpu_layers=-1) قد يتسبب بتعطّل صلب (crash) لا يمكن التقاطه في بايثون
    # على بعض أجهزة Apple Silicon ذات الذاكرة المحدودة؛ CPU أبطأ لكنه مستقر.
    # n_ctx كبير (8192) ضروري لأن حزمة الحيثيات + السوابق المسترجعة من الأرشيف قد تتجاوز
    # 2000-3000 رمز بسهولة؛ سياق أصغر يقطع جزءًا من التعليمات أو السوابق بصمت فتظهر
    # النصوص المولَّدة وكأنها تجاهلت الأرشيف تمامًا. نحاول أحجامًا أصغر فقط إن فشل التحميل
    # (مثلًا على جهاز بذاكرة أقل من ذلك)، وليس كخيار افتراضي.
    last_error = None
    for ctx_size in (n_ctx, 4096, 2048):
        try:
            llm = Llama(model_path=model_path, n_ctx=ctx_size, n_gpu_layers=0, verbose=False)
            _loaded["path"] = model_path
            _loaded["llm"] = llm
            return llm
        except Exception as e:
            last_error = e
    raise LocalLLMError(f"تعذّر تحميل النموذج من الملف:\n{model_path}\n{last_error}") from last_error


def generate(models_folder: str, model_filename: str, prompt: str, system: str = "") -> str:
    if not model_filename:
        raise LocalLLMError("لم يتم اختيار ملف نموذج محلي (GGUF) من تبويب الإعدادات.")
    model_path = os.path.join(models_folder or "", model_filename)
    if not os.path.exists(model_path):
        raise LocalLLMError(f"ملف النموذج غير موجود:\n{model_path}")
    llm = _get_llm(model_path)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        resp = llm.create_chat_completion(messages=messages, temperature=0.3, max_tokens=2048)
        return resp["choices"][0]["message"]["content"]
    except Exception as e:
        raise LocalLLMError(f"خطأ أثناء التوليد بالنموذج المحلي:\n{e}") from e
