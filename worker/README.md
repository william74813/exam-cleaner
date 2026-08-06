# Exam Cleaner v2.2 安全 AI Proxy

此 Worker 代替 GitHub Pages 前端呼叫 Gemini。`GEMINI_API_KEY` 與 `ACCESS_TOKEN` 只存於 Cloudflare Worker Secrets 或 GitHub Actions Secrets，不可寫入程式碼、網址、Issue 或聊天訊息。

## 已實作

- `GET /health`：檢查 Worker 是否已設定必要 Secrets，不會回傳任何秘密值。
- `POST /api/clean`：接收 `exam-clean-v2` 圖片請求並呼叫 Gemini 圖像編輯模型。
- 限制來源為 `https://william74813.github.io`。
- 強制 `X-Exam-Cleaner-Token` 存取權杖。
- 每個存取權杖每分鐘最多 5 次請求。
- 限制圖片格式、尺寸及 Base64 大小。
- 125 秒逾時，暫時性錯誤只重試一次。
- 不記錄圖片、Base64、API Key 或存取權杖。

## 方法一：GitHub Actions 手動部署

在 GitHub 儲存庫進入：

`Settings → Secrets and variables → Actions → New repository secret`

建立四個 Secrets：

| Secret 名稱 | 內容 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 僅限該帳號 Workers 編輯權限的 API Token |
| `GEMINI_API_KEY` | Google AI Studio 建立的 Gemini API Key |
| `EXAM_CLEANER_ACCESS_TOKEN` | 自行產生的長隨機字串，建議至少 32 字元 |

完成後到：

`Actions → Deploy v2.2 AI Proxy → Run workflow`

部署成功後，工作流程摘要會顯示 Worker URL，通常為：

`https://exam-cleaner-proxy.<你的 workers.dev 子網域>.workers.dev`

前端 Proxy URL 應填：

`https://exam-cleaner-proxy.<你的 workers.dev 子網域>.workers.dev/api/clean`

前端存取權杖填入 `EXAM_CLEANER_ACCESS_TOKEN` 的值。

## 方法二：本機 Wrangler 部署

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ACCESS_TOKEN
npm run check
npm run deploy
```

不要使用 `vars` 保存 API Key 或存取權杖。

## 健康檢查

瀏覽器開啟：

`https://<Worker 網域>/health`

正確設定時應看到：

```json
{
  "service": "exam-cleaner-proxy",
  "apiVersion": "exam-clean-v2",
  "ready": true,
  "authRequired": true
}
```

`ready: false` 代表 `GEMINI_API_KEY` 或 `ACCESS_TOKEN` 尚未設定。

## 安全提醒

- 不要把任何 Secret 提交到 GitHub 檔案。
- 不要把 API Key 貼在 Issue、PR、聊天或畫面截圖。
- Cloudflare API Token 應限制於單一帳號及 Workers 編輯權限。
- 發現異常用量時，立即輪替 Gemini API Key 與存取權杖。
