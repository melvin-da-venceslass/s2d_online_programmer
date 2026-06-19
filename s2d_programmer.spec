# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for s2d_online_programmer
# Build (on Linux):
#   pyinstaller s2d_programmer.spec
# Output: dist/s2d_programmer  (single-folder bundle)
#
# To build a fully portable ZIP:
#   cd dist && zip -r s2d_programmer.zip s2d_programmer/

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_all

# ── Collect data from packages that embed resource files ─────────────────────
datas = []

# uvicorn ships its own lifespan/logging config, etc.
uvicorn_datas, uvicorn_bins, uvicorn_hiddenimports = collect_all('uvicorn')
datas += uvicorn_datas

# starlette
starlette_datas, starlette_bins, starlette_hiddenimports = collect_all('starlette')
datas += starlette_datas

# fastapi
fastapi_datas, fastapi_bins, fastapi_hiddenimports = collect_all('fastapi')
datas += fastapi_datas

# jinja2
jinja2_datas, _, _ = collect_all('jinja2')
datas += jinja2_datas

# reportlab
reportlab_datas, _, _ = collect_all('reportlab')
datas += reportlab_datas

# pandas
pandas_datas, _, _ = collect_all('pandas')
datas += pandas_datas

# ── Application assets ────────────────────────────────────────────────────────
# Templates, static files, and config all need to live next to the executable
# at runtime.  They are added as data tuples: (src, dest_inside_bundle).
datas += [
    ('templates',       'templates'),
    ('static',          'static'),
    ('template.json',   '.'),
    ('.env',            '.'),
]

# Optional: include a programs skeleton directory so the app starts clean
# (comment out if you ship programs separately)
datas += [
    ('programs',        'programs'),
    ('program-index.json', '.'),
]

# App sub-packages
datas += [
    ('entities',    'entities'),
    ('enums',       'enums'),
    ('models',      'models'),
    ('repository',  'repository'),
    ('schemas',     'schemas'),
    ('services',    'services'),
]

# ── Hidden imports ────────────────────────────────────────────────────────────
hidden_imports = [
    # uvicorn / starlette internals
    *uvicorn_hiddenimports,
    *starlette_hiddenimports,
    *fastapi_hiddenimports,
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.loops.uvloop',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.off',
    'uvicorn.lifespan.on',
    # fastapi / starlette
    'fastapi',
    'fastapi.middleware',
    'starlette.routing',
    'starlette.staticfiles',
    'starlette.templating',
    'starlette.responses',
    'starlette.middleware.cors',
    # http & serialisation
    'anyio',
    'anyio._backends._asyncio',
    'anyio._backends._trio',
    'h11',
    'httptools',
    'websockets',
    'wsproto',
    # jinja2
    'jinja2',
    'markupsafe',
    # data / pdf
    'pandas',
    'pandas._libs.tslibs.np_datetime',
    'pandas._libs.tslibs.nattype',
    'pandas._libs.tslibs.timedeltas',
    'pandas._libs.tslibs.offsets',
    'pandas._libs.tslibs.timestamps',
    'pandas._libs.sparse',
    'pandas._libs.ops_dispatch',
    'pandas._libs.reduction',
    'pandas.io.formats.style',
    'numpy',
    'numpy.core._multiarray_umath',
    'reportlab',
    'reportlab.graphics',
    'reportlab.pdfgen',
    'reportlab.platypus',
    'reportlab.lib',
    # python std
    'zipfile',
    'io',
    'pathlib',
    'json',
    'shutil',
    'subprocess',
    'multiprocessing',
    'email.mime.text',
    'email.mime.multipart',
    # multipart form parsing
    'python_multipart',
    'multipart',
]

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=uvicorn_bins + starlette_bins + fastapi_bins,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['_runtime_hook.py'],
    excludes=[
        'tkinter', 'matplotlib', 'scipy', 'PIL', 'cv2',
        'IPython', 'notebook', 'pytest',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

# ── Single-folder bundle (recommended for servers) ───────────────────────────
# Change onedir → onefile by uncommenting the EXE block below and removing
# the COLLECT block.  onefile is slower to start because it unpacks each run.

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,        # keep binaries in the folder (onedir)
    name='s2d_programmer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,                 # keep console so uvicorn logs are visible
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='s2d_programmer',        # output folder: dist/s2d_programmer/
)
