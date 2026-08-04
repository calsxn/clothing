FiveM Texture Optimizer
=======================

Shrinks the textures for your cars, clothing and MLOs (resizes them, compresses
them properly and adds mipmaps) so your server uses less VRAM, loads faster and
stops the low-res / "texture failed to load" stutter.

=========================================================
RUN IT - THE DESKTOP APP (recommended)
=========================================================

1. Double-click "Texture Optimizer.bat".
   The app opens in its OWN window - no web browser, no tabs, no address bar.
   (A tiny window may sit minimized in your taskbar; that just keeps the app
   running. Closing the app window closes everything.)

2. In the app:
   - Paste the folder you want to clean up
     (e.g.  C:\FXServer\resources\[cars] )
   - Choose what the textures are for: Cars / Clothing / MLO / Mixed.
   - Click "Scan".

3. You get a clear PREVIEW: how many textures were found, how many can be made
   smaller, and exactly what each one will become. NOTHING is changed yet.

4. When it looks good, click "Optimize now". A progress bar shows each file as
   it goes. Your originals are backed up first (into "_backup_textures") so you
   can always undo.

(The app window uses the Microsoft Edge engine that's already built into
Windows 10/11 - nothing extra to install. If Edge/Chrome can't be found it
falls back to opening in your normal browser.)


=========================================================
SHARE IT WITH YOUR TEAM (optional)
=========================================================

Instead of the desktop app, you can run it as a page your teammates open in a
browser: double-click "Start Optimizer UI.bat". It stays at http://localhost:3001
and anyone on the SAME network can open  http://YOUR-PC-IP:3001  (find your IP
by running "ipconfig" - look for the IPv4 Address).

Only people you trust should use it, because it can change files on the PC it
runs on. The folder someone picks is ON THE COMPUTER RUNNING THE TOOL, so run it
on the machine that has your resource files (e.g. your FiveM box).


=========================================================
THE COMMAND-LINE WAY (for one person / scripts)
=========================================================

Double-click "Optimize Textures.bat", then drag your resource folder onto the
window. Or run it directly:

  node optimize.js <folder> [options]

  --type <cars|clothing|mlo|auto>  Preset size cap (default auto = 2048px)
  --max <pixels>                   Force a max size, e.g. --max 1024
  --format <BC1|BC3|BC7>           Force one format for everything
                                   (BC7 = best quality, slightly bigger)
  --aggressive                     Use a 1024px cap for maximum savings
  --apply                          Actually rewrite files (default is a preview)
  --no-backup                      Don't copy originals to _backup_textures
  --replace                        Delete the original PNG/JPG after making a DDS
  --quiet                          Only print the summary
  --help                           Full help

Examples:
  node optimize.js "C:\fivem\resources\mycars"              (preview)
  node optimize.js "C:\fivem\resources\mycars" --apply      (do it)
  node optimize.js "C:\clothes" --type clothing --aggressive --apply


=========================================================
WHAT IT ACTUALLY DOES
=========================================================

For each loose texture it finds (.dds .png .jpg .tga .bmp) it will:
  - shrink anything bigger than the size cap down to a power-of-two size
    (default cap 2048px; "extra small" / --aggressive uses 1024px),
  - compress it with the right format
    (DXT1/BC1 for solid textures, DXT5/BC3 for ones with transparency),
  - build a full mipmap chain (the big fix for shimmering and VRAM spikes).
Textures that are already sized, compressed and mipmapped are left alone.


OPTIMIZING .YTD PACKS AUTOMATICALLY (cars / clothing / MLO)
-----------------------------------------------------------
In FiveM the finished textures live packed inside .ytd archives. This tool can
open them, optimize every texture inside, and repack them for you - but it needs
a small helper to unpack/repack .ytd files, because that's a special format.

  1. Get GTAUtil (a free CodeWalker-based command-line tool). Search "GTAUtil"
     on GitHub and download the release - it's a folder with gtautil.exe inside.
     (OpenIV has no command line, so it can't be automated - GTAUtil is the one
     that can. Any compatible CodeWalker CLI works too.)
  2. In the web UI, open "One-time setup" at the top and paste the full path to
     gtautil.exe, then click Save. It shows "connected" when it's happy.
  3. Now when you scan a folder, tick "Also optimize the .ytd packs" before you
     click Optimize. The tool unpacks each .ytd, optimizes the textures, and
     repacks it (your original .ytd is backed up first).

If you skip this step the tool still optimizes all your loose textures and just
LISTS the .ytd files by size so you can spot the bloated ones.

Advanced: the tool path and the exact unpack/repack commands live in config.json
next to this tool, so you can point it at a different CLI or adjust the commands
if your version of GTAUtil uses different flags.


REQUIREMENTS
------------
- Node.js. The .bat files first look for the "node" folder that ships with the
  Clothing Tracker (one folder up), then a "node" folder here, then any Node.js
  on your system. If you don't have it: https://nodejs.org
- texconv.exe (Microsoft DirectXTex) does the actual compression. On Windows it
  downloads automatically the first time you optimize. If that fails, grab it
  from https://github.com/microsoft/DirectXTex/releases and drop it in a "bin"
  folder next to optimize.js. (Scanning/preview works without it; rewriting is
  Windows-only.)


ROLLING BACK
------------
Everything the tool rewrites is copied into "_backup_textures" (mirroring the
original folder layout) before it changes anything. To undo, copy those files
back over the originals.
