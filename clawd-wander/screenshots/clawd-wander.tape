# README の clawd-wander.gif を撮り直す vhs のスクリプト。リポジトリ直下で実行する。
#   vhs clawd-wander/screenshots/clawd-wander.tape
#   ffmpeg -y -i /tmp/clawd-wander.mp4 -filter_complex "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" clawd-wander/screenshots/clawd-wander.gif
Output "/tmp/clawd-wander.mp4"
Set Shell zsh
Set FontSize 15
Set Width 1200
Set Height 640
Set Framerate 20
Set Padding 16
Set TypingSpeed 10ms

# Claude Code の中から実行したときに引き継ぐ警告と、利用状況が映るステータスラインを外す
Hide
Type "unset CLAUDE_CODE_CHILD_SESSION && clear"
Enter
Type `claude --plugin-dir ./clawd-wander --model sonnet --settings '{"statusLine":{"type":"command","command":"true"}}' --allowedTools "Bash(sleep:*)" Read Glob`
Enter
Sleep 10s
Show

# 仲間が増える・道具を持つ・仲間が消える・作業が終わる、までを一度に映す
Type "Launch 3 general-purpose agents in parallel in the background; each one runs `sleep 15` with Bash and replies 'done'. While they run, read README.md and clawd-wander/README.md, then run `sleep 20` yourself. Finish with a one-line summary."
Sleep 500ms
Enter
Sleep 50s
Hide
Ctrl+C
Ctrl+C
