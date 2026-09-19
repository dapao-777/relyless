# RelyLess Privacy Policy

Effective date: September 19, 2026

This policy explains how the RelyLess browser extension ("the Extension") handles your data. Please read it before use.

## 1. Data Controller and Contact

Publisher: Elazer
Contact email: rocky.think.zc@gmail.com

For privacy-related questions, contact us at the email above.

## 2. How We Handle Data

### 2.1 Local-first, not fully offline

The Extension is local-first by default: local domain classification and on-device records do not require uploading entire pages to any server we operate; the Extension does **not** run a relay cloud service, and we do not operate any server that collects your reading content.

However, when you use AI assistance, the text needed for the task is sent to the model provider you select (for example, an API endpoint you configure, or the ChatGPT service reached through a native connector you install).

### 2.2 Content sent to your model provider

When you use AI assistance, the following is sent to your selected model provider:

- **Reading assistance**: target words/sentences plus applicable page title, section information, and context. Automatically prepared article context is at most 12,000 characters; a short article may be included in full. Requests also contain task instructions and structured-output constraints.
- **Remote domain detection** (if you select that mode): a title and a length-limited body sample. The default local domain detection does not produce this remote request.
- **Manual selection translation**: the selected fragment plus limited context.
- **Bilingual page translation**: only after confirmation, nearby body text and limited context — title and current section up to 160 characters each, adjacent body text up to 400 characters before and after; at most four items per batch, source text up to 4,000 characters in total, and source-plus-context up to 12,000 characters. Input fields, hidden body text, and video captions are not read.
- **Reading summaries** (if you explicitly enable): length-limited reading samples.
- **Personalization analysis** (if you further enable): limited queries, example sentences, summaries, and objective activity statistics from the last 30 days.

Request payloads do not actively include the page URL, but providers still receive normal network request metadata and may record requests, accounts, and content under their own terms. **We cannot guarantee that a third-party or self-hosted API endpoint does not retain data.** Review your provider's privacy and retention policies before use.

### 2.3 What is stored on-device

- **API keys and service configuration**: stored in your browser's local extension storage, used to authenticate to the corresponding endpoint.
- **Personal vocabulary profile**: on by default, used to "remember requested words and support preferences." It does not store source sentences, titles, or source URLs. You can disable it in settings (after which it is no longer read or updated) or clear it under "Data & Privacy."
- **Prepared explanations and limited context cache**: kept only for the current browser session.
- **Successful bilingual translation results**: only in a five-minute, at most 256-entry in-memory cache.

## 3. Features That Require Explicit Opt-in

The following are off by default and run only after you explicitly enable them:

- **Reading history**: requires explicit enabling and adding allowed websites; disabling collection does not automatically delete existing records. Incognito pages are not collected.
- **Reading summaries**: built on top of reading history, require separate enabling.
- **Remote personalization analysis**: built on top of reading history, require separate enabling.

## 4. Data Categories

The Extension may process the following categories of data:

- **Website content**: words, sentences, body samples, titles, sections, and context used for AI assistance, sent to your configured provider.
- **Authentication information**: API keys you enter, stored on-device, used to authenticate to the corresponding endpoint.
- **User activity**: optional reading history and analysis processing reading, queries, and activity evidence within the scope you allow.

## 5. Retention and Deletion

- You can export or clear on-device data under the Extension's "Data & Privacy."
- We do not retain your reading content on any server we operate.
- Data already sent to third-party model providers is subject to their own retention and deletion policies, outside our control.

## 6. Third-Party Services

The Extension allows you to connect third-party model providers (API endpoints or the ChatGPT subscription connector). These third-party services are governed by their own privacy policies. We recommend reviewing them.

## 7. Children

The Extension is not directed at children and does not knowingly collect personal information from children.

## 8. Policy Changes

If this policy changes materially, we will note it in a new extension version or on this page.

## 9. Contact

Publisher: Elazer
Email: rocky.think.zc@gmail.com
