# Minimal tkinter stub so app.py / department_panel.py import without a display.
class _Any:
    def __init__(self, *a, **k): pass
    def __call__(self, *a, **k): return _Any()
    def __getattr__(self, name): return _Any()
    def __iter__(self): return iter(())
    def __bool__(self): return False
class TclError(Exception): pass
def __getattr__(name):
    return _Any
Tk = Frame = Label = Button = Canvas = Text = Toplevel = Menu = Listbox = PhotoImage = StringVar = BooleanVar = _Any
import importlib as _il
ttk = _il.import_module(__name__ + '.ttk')
filedialog = _il.import_module(__name__ + '.filedialog')
messagebox = _il.import_module(__name__ + '.messagebox')
