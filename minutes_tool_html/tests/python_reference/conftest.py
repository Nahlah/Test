import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "stubs"))
sys.path.insert(0, os.path.dirname(__file__))
if os.environ.get("RE_RECORD_OUT"):
    import re_recorder
    re_recorder.install()
if os.environ.get("FN_RECORD_OUT"):
    import fn_recorder
    fn_recorder.install()
    try:
        fn_recorder.install_app_hooks()
    except Exception as e:
        print("app hooks failed:", e)
