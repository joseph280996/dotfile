# Slack Markdown Formatter

A Claude Code skill that enables proper formatting of messages for Slack using "mrkdwn" syntax.

## Overview

Slack uses its own markdown variant called "mrkdwn" which differs significantly from standard markdown. This skill provides Claude Code with the correct syntax and best practices for formatting messages that will display properly in Slack.

## What This Skill Does

When you ask Claude Code to format messages for Slack, this skill automatically:

- Converts standard markdown to Slack's mrkdwn syntax
- Applies correct formatting for bold, italic, strikethrough, and code
- Uses Slack's unique link syntax (`<url|text>`)
- Handles Slack-specific features (user mentions, channel links, special mentions)
- Provides guidance on when to use Block Kit for rich messages
- Avoids unsupported features (headings, tables, etc.)

## Installation

### Using Claude Code

1. Download this repository
2. Copy to your Claude Code skills directory:
   ```bash
   cp -r slack-markdown-formatter ~/.claude/skills/
   ```
3. The skill will automatically activate when you ask Claude to format Slack messages

### From Release Package

1. Download the latest `slack-markdown-formatter.zip` from [Releases](https://github.com/sirkitree/slack-markdown-formatter/releases)
2. Extract to `~/.claude/skills/`
3. The skill is ready to use

## Usage

Once installed, the skill automatically triggers when you:

- Ask to format messages for Slack
- Request Slack notifications
- Mention Slack Block Kit
- Need to convert markdown to Slack format

### Example Interactions

**Simple formatting:**
```
You: Format this for Slack: Check out **this article** on _productivity_

Claude: Check out *this article* on _productivity_
```

**With links:**
```
You: Create a Slack message linking to our docs

Claude: See our <https://docs.example.com|documentation> for details
```

**Notifications:**
```
You: Write a Slack deployment notification

Claude: <!here> :rocket: *Deployment Complete*

Version 2.1.0 has been deployed to production.

<https://github.com/org/repo/releases/v2.1.0|View Release Notes>
```

## What's Included

### SKILL.md
The main skill file containing:
- Overview and usage guidelines
- Core syntax differences from standard markdown
- Slack-specific features (mentions, channels, dates)
- Workflow for formatting messages
- Practical examples
- Block Kit integration guidance

### references/slack-mrkdwn-guide.md
Comprehensive reference documentation with:
- Complete syntax comparison tables
- Official documentation links
- Edge cases and limitations
- Best practices
- Common mistakes and solutions
- Quick reference card

## Key Syntax Differences

| Feature | Standard Markdown | Slack mrkdwn |
|---------|------------------|--------------|
| Bold | `**text**` | `*text*` |
| Italic | `*text*` | `_text_` |
| Strikethrough | `~~text~~` | `~text~` |
| Link | `[text](url)` | `<url\|text>` |
| User Mention | N/A | `<@U12345678>` |
| Channel Link | N/A | `<#C12345678>` |
| Special Mention | N/A | `<!here>` `<!channel>` |

## Unsupported Features

These standard markdown features don't work in Slack:
- Headings (`#`, `##`, etc.)
- Tables
- HTML tags
- Image embedding with `![alt](url)`
- Nested formatting
- Task lists

## Block Kit

For rich, interactive messages with:
- Structured layouts
- Buttons and interactive elements
- Images and media
- Forms and inputs

Use Slack's Block Kit instead of plain mrkdwn. The skill provides guidance on when and how to use Block Kit.

## Resources

### Official Documentation
- [Slack API Formatting Reference](https://api.slack.com/reference/surfaces/formatting)
- [Slack Block Kit](https://api.slack.com/block-kit)
- [Block Kit Builder](https://api.slack.com/block-kit/building)

### Community Guides
- [DX Documentation: Slack Markdown Guide](https://docs.getdx.com/slack-markdown/)
- [Wrangle: Comprehensive Guide to Slack Markdown](https://www.wrangle.io/post/slack-markdown-a-comprehensive-guide-to-formatting-messages)

## Contributing

Contributions are welcome! If you find issues or have suggestions:

1. Open an issue describing the problem or enhancement
2. Submit a pull request with improvements
3. Share your use cases and examples

## License

MIT License - See [LICENSE](LICENSE) for details

## About Claude Code Skills

This is a skill for [Claude Code](https://claude.com/claude-code), Anthropic's official CLI tool. Skills extend Claude's capabilities with specialized knowledge and workflows.

Learn more about creating skills in the [Claude Code documentation](https://docs.claude.com/claude-code).

## Author

Created by [@sirkitree](https://github.com/sirkitree)

---

**Note:** This skill teaches Claude Code the correct Slack formatting syntax. It does not send messages to Slack directly - you'll need to copy the formatted output into Slack or use Slack's API for programmatic posting.
