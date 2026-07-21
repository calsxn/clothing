FiveM Clothing Tracker
======================

HOW TO START
------------
Double-click "Start Website.bat", then open http://localhost:3000 in your browser.
Keep the black window open - that's the server. Close it to stop the website.

WHAT IT DOES
------------
- Everyone makes their own account (username + password)
- Four sections: Male, Female, Gang, Peds
- Male/Female items are tagged with a pack (Base / Factions / Paid)
- Add clothes with category, file/drawable #, texture count, status
  (Good / Vacant / Needs Approval...), gang name, a picture and notes
- Everything is saved in one shared database (data.db) so every account
  sees the same synced list. You can only edit/delete items YOU added.

LETTING FRIENDS USE IT (INTERNET)
---------------------------------
Double-click "Start Everything.bat". It starts the website AND a free
Cloudflare tunnel that puts it on the internet. A link ending in
".trycloudflare.com" appears in the window - send that link to your
friends. Keep both black windows open while people use the site.

- The link CHANGES every time you restart the tunnel, so re-share it.
- Your home IP stays hidden and the link is https (encrypted).
- Same network only? They can also use http://YOUR-PC-IP:3000
  (find your IP with "ipconfig" - look for IPv4 Address).
- For a site that's up 24/7 with a permanent address, copy this whole
  folder to a VPS or your FiveM box and run it there instead.

YOUR DATA
---------
Everything lives in "data.db" in this folder. Back that file up to keep
your collection safe. The "node" folder is the portable Node.js runtime
the server needs - don't delete it.
