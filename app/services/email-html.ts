function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function wrapEmailHtml(content: string, storeName: string): string {
  if (/<html|<!DOCTYPE|<body/i.test(content)) return content;

  const formattedContent = /<\/?[a-z][\s\S]*>/i.test(content)
    ? content
    : content.replace(/\n/g, "<br/>");
  const safeStoreName = escapeHtml(storeName || "Grand Le Mar");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      background-color: #f8fafc;
      color: #334155;
      line-height: 1.6;
    }
    .email-container {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 8px;
      padding: 32px 36px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      border: 1px solid #e2e8f0;
      box-sizing: border-box;
    }
    .email-header {
      border-bottom: 2px solid #de4066;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 700;
      color: #de4066;
    }
    .email-body {
      font-size: 14.5px;
      color: #334155;
    }
    .email-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <div class="brand-name">${safeStoreName}</div>
    </div>
    <div class="email-body">
      ${formattedContent}
    </div>
    <div class="email-footer">
      &copy; ${new Date().getFullYear()} ${safeStoreName}. All rights reserved.
    </div>
  </div>
</body>
</html>`;
}