FiveM Texture Optimizer
=======================

Shrinks the textures for your cars, clothing and MLOs (resizes them, compresses
them properly and adds mipmaps) so your server uses less VRAM, loads faster and
stops the low-res / "texture failed to load" stutter.

There are two ways to use it: an easy web page (best for a team) or the command
line. Both use the same engine.


=========================================================
THE EASY WAY - A WEB PAGE FOR YOUR WHOLE TEAM (recommended)
=========================================================

1. Double-click "Start Optimizer UI.bat".
   A black window opens and your browser goes to  http://localhost:3001
   Keep that black window open the whole time - it's the program.

2. In the page:
   - Paste the folder you want to clean up
     (e.g.  C:\FXServer\resources\[cars] )
   - Choose what the textures are for: Cars / Clothing / MLO / Mixed.
   - Click "Scan".

3. You get a clear PREVIEW: how many textures were found, how many can be made
   smaller, and exactly what each one will become. NOTHING is changed yet.

4. When it looks good, click "Optimize now". A progress bar shows each file as
   it goes. Your originals are backed up first (into "_backup_textures") so you
   can always undo.

LETTING THE TEAM USE IT
   Anyone on the SAME network can open  http://YOUR-PC-IP:3001  in their browser
   (find your IP by running "ipconfig" - look for the IPv4 Address). Only people
   you trust should use it, because it can change files on the PC it runs on.

   Note: the person running the page picks a folder ON THE COMPUTER RUNNING THE
   TOOL. Run it on the machine that has your resource files (e.g. your FiveM box).


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


ABOUT .YTD FILES (packed vehicle / clothing / MLO textures)
-----------------------------------------------------------
In FiveM the finished textures usually live packed inside .ytd archives. This
tool LISTS your .ytd files by size (so you can spot the bloated ones) but does
NOT crack them open - repacking a .ytd safely needs OpenIV or CodeWalker:
  1. Open the .ytd in OpenIV / CodeWalker and export its textures (as .dds).
  2. Run this tool on the exported folder.
  3. Import the optimized .dds back into the .ytd and save.
For source/dev texture folders and any loose textures, this tool does it all.


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
