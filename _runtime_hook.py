"""
PyInstaller runtime hook — executed before any app code.
Sets the working directory to sys._MEIPASS so that all relative
paths (templates/, static/, .env, etc.) resolve correctly whether
the app is run from inside the bundle or from source.
"""
import os
import sys

if getattr(sys, 'frozen', False):
    # Running inside a PyInstaller bundle
    os.chdir(sys._MEIPASS)
