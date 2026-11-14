# PyInstaller spec: py -m PyInstaller helper/host.spec --noconfirm --clean --distpath helper/dist --workpath helper/build
import os

# SPECPATH is the directory containing this spec (helper/)
_icon = os.path.join(SPECPATH, '..', 'installer', 'goko.ico')
_icon = os.path.abspath(_icon) if os.path.exists(_icon) else None

a = Analysis(
    [os.path.join(SPECPATH, 'host.py')],
    pathex=[SPECPATH],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', '_tkinter', 'unittest', 'pydoc', 'doctest', 'test', 'distutils',
              'email', 'http', 'xml', 'asyncio', 'sqlite3', 'ssl', 'lzma', 'bz2'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='GokoHost',
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=_icon,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='GokoHost',
)
