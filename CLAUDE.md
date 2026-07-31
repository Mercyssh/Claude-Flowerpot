# CLAUDE.md

---

## How to respond to me

<!-- Your rules go here. A few starters — keep, change or delete them. -->

- Don't re-explain code I can read. Explain the *why* when it isn't
  obvious from the diff.
- Don't explain every minute detail of the changes unless i ask explicitely
- Point out potential future issues if you think there could be any. When pointing out potential future issues, highlight the text when writing them. Explain the circumstance that would trigger them, and mention a potential fix in a concise manner
- When adding any new Variables which control visual parameters, list them out along with what they control in a table format
- Try to keep your messages concise, don't spend too many tokens on the message, I would rather you focus on the code output 

## Workflow

- **Do not start a preview server or verify in the browser.** I check
  the site myself. Write the change, explain it, and stop. I will ask
  for a verification pass when I want one.
- Don't leave scratch files in the repo. Clean up anything temporary.
- Prefer editing existing files over adding new ones.