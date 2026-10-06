# pr-status

A Claude Code mod that shows the live state of GitHub pull requests wherever Claude links to one.

- Each PR link in Claude's replies becomes the PR's Octicon, its number and its title, for example ` #42 Fix flaky login test`.
- The icon and number are colored by state: green for open, gray for draft, purple for merged, red for closed. Approved and changes-requested PRs get a second icon.
- The title is underlined and links to the PR.
- The mod rechecks open PRs every minute and merged or closed PRs every 10 minutes. When a state changes, every message showing that PR redraws.
- On a real state change (for example open to merged), you get a toast and Claude gets a short note, so it stops treating a merged PR as open.

## Requirements

- Claude Code 2.1.287 or later, in the terminal or the Desktop app's Code tab.
- The [GitHub CLI](https://cli.github.com/) (`gh`), logged in. The mod runs `gh pr view` to read PR state.
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal for the Octicon glyphs.

## Install

At a Claude Code prompt:

```
/plugin install pr-status --marketplace patrickdundas/claude-code-pr-status
```

Answer `y` to add the marketplace, then pick a scope.

## Notes

- Colors only apply on lines the mod draws itself. A PR link inside a table or a code block shows the icon and title without color.
- In the classic (non-fullscreen) renderer, messages that have scrolled into the terminal's own scrollback cannot be redrawn. Fullscreen mode (`"tui": "fullscreen"`) redraws them all.
- If links print as `title (url)` instead of being clickable, Claude Code does not think your terminal supports hyperlinks. Set `FORCE_HYPERLINK=1` in your environment or in the `env` block of `~/.claude/settings.json`.

## Development

```
claude plugin validate .
claude plugin test .
```
