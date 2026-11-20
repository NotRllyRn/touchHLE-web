# Lab7 affected-session capture

Use the existing HTTPS game address in Brave on the MacBook. Keep site data intact.

1. Open Lab7 and reproduce the slow gameplay. Note Brave version (brave://version),
   macOS version, window size and whether zoom is at100%.
2. Open Brave Developer Tools with Option+Command+I, select Performance, start
   recording, return focus to the game and play for20–30seconds while it is slow.
   Stop recording and use Save/Export profile to download the trace. Keep default
   profiling settings and note that DevTools adds overhead; this is diagnostic,
   not a benchmark. Do not record unrelated browsing.
3. In the game use More options → Saved files. Wait for normal save/stop completion,
   then use its Download/export link to download a COPY of game progress. Do not
   clear site data, delete saves or import over the current progress.
4. Attach the trace and save export to the coordinator thread, with the exact taps
   from Lab7 selection to the slowdown, browser/macOS versions, and when captured.
   These files stay private and must never be committed to the repository.

If only one file is practical, start with the save export so the existing Lab7
progress can be reproduced in isolated test storage. The affected-device trace
is still needed to attribute the MacBook slowdown accurately. No speedup or
full-game completion is established by the existing headless Lab001 diagnostics.
