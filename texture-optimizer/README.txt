FiveM Texture Optimizer
=======================

Rebuilds bloated textures for cars, clothing and MLOs as properly compressed
DDS files with mipmaps, so your server uses less VRAM, streams cleaner and
stops throwing "texture failed to load" / low-res-texture stutter.


HOW TO START (the easy way)
---------------------------
1. Double-click "Optimize Textures.bat".
2. Drag your resource folder onto the black window (or paste its path) and
   press Enter. Pick a type (cars / clothing / mlo / mixed).
3. It shows a PREVIEW of everything it would change - nothing is touched yet.
4. If it looks good, answer "y" when it asks to apply. Your original files are
   copied into "_backup_textures" first, so you can always roll back.

Tip: you can also just drag a folder straight onto "Optimize Textures.bat" to
get an instant preview.


WHAT IT DOES
------------
It scans the folder (and every sub-folder) and for each loose texture it finds
(.dds .png .jpg .tga .bmp) it will:

  - shrink anything bigger than the size cap down to a power-of-two size
    (default cap 2048px; --aggressive uses 1024px),
  - compress it with the right DDS/BC format
    (DXT1/BC1 for solid textures, DXT5/BC3 for ones with transparency),
  - build a full mipmap chain (this is the big one for stopping shimmering and
    VRAM spikes when textures are viewed from a distance).

Textures that are already the right size, compressed and mipmapped are left
alone.


ABOUT .YTD FILES (vehicles / clothing / MLO packs)
--------------------------------------------------
In FiveM the finished textures for cars, clothing and MLOs live packed inside
.ytd archives. This tool does NOT crack open .ytd files - it lists them by size
so you can spot the bloated ones, but repacking a .ytd safely needs OpenIV or
CodeWalker. The workflow is:

  1. Open the .ytd in OpenIV / CodeWalker and export its textures (as .dds).
  2. Run this tool on the exported folder (with --apply).
  3. Import the optimized .dds back into the .ytd and save.

For source/dev texture folders and any loose textures, this tool does the whole
job on its own.


COMMAND LINE (for advanced use)
-------------------------------
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


REQUIREMENTS
------------
- Node.js. The included .bat first looks for the "node" folder that ships with
  the Clothing Tracker (one folder up), then a "node" folder here, then any
  Node.js on your system. If you don't have it, get it from https://nodejs.org
- texconv.exe (Microsoft DirectXTex) does the actual compression. On Windows the
  tool downloads it automatically the first time you use --apply. If that fails
  (no internet, locked-down PC), download texconv.exe yourself from
  https://github.com/microsoft/DirectXTex/releases and drop it in the "bin"
  folder next to optimize.js.


ROLLING BACK
------------
Everything the tool rewrites is copied into "_backup_textures" (mirroring the
original folder layout) before it changes anything. To undo, copy those files
back over the originals.
