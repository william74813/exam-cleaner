# Exam Cleaner v2.2 OpenAI 安全 Proxy

此 Cloudflare Worker 代替 GitHub Pages 前端呼叫 OpenAI 圖片編輯 API。`OPENAI_API_KEY` 與 `ACCESS_TOKEN` 只存於 Cloudflare Worker Secrets 或 GitHub Actions Secrets，不可寫入程式碼、網址、Issue、截圖或聊天訊息。

## 已實作

- `GET /health`：檢查 Worker 是否已設定必要 Secrets，不會回傳任何秘密值。
- `GET /auth-check`：驗證前端來源與存取權杖，不會上傳圖片或呼叫 OpenAI。
- `POST /api/clean`：接收 `exam-clean-v2` 圖片請求並呼叫 OpenAI `POST /v1/images/edits`。
- 預設模型：`gpt-image-1.5`。
- 使用 `input_fidelity: high`、`quality: high`、`size: auto` 與 PNG 輸出。
- 限制來源為 `https://william74813.github.io`。
- 強制 `X-Exam-Cleaner-Token` 存取權杖。
- 每個存取權杖每分鐘最多 5 次請求。
- 限制圖片格式、尺寸及 Base64 大小。
- 180 秒逾時，暫時性錯誤只重試一次。
- 不記錄圖片、Base64、OpenAI API Key 或存取權杖。

## 第一步：建立 OpenAI API Key

1. 登入 OpenAI API Platform。
2. 建立或選擇一個 Project。
3. 設定 API 帳務與支出上限。
4. 在該 Project 建立 API Key。
5. 金鑰只在建立時複製一次，請直接存進密碼管理器或 GitHub Secret。

ChatGPT Plus 與 OpenAI API 帳務分開；已有 Plus 不代表 API 已啟用。

## 第二步：建立 Cloudflare 部署憑證

Cloudflare 只作為安全後端，避免 OpenAI API Key 出現在手機網頁中。需準備：

- Cloudflare Account ID。
- 只授予 Workers 編輯權限的 Cloudflare API Token。

## 第三步：設定 GitHub Actions Secrets

在 GitHub 儲存庫進入：

`Settings → Secrets and variables → Actions → New repository secret`

建立四個 Secrets：

| Secret 名稱 | 內容 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 僅限 Workers 編輯權限的 Cloudflare API Token |
| `OPENAI_API_KEY` | OpenAI API Platform 建立的 Project API Key |
| `EXAM_CLEANER_ACCESS_TOKEN` | 自行產生的長隨機字串，建議至少 32 字元 |

## 第四步：部署

完成後到：

`Actions → Deploy v2.2 OpenAI Proxy → Run workflow`

在確認欄位輸入：

`DEPLOY`

部署成功後，工作流程摘要會顯示 Worker URL，通常為：

`https://exam-cleaner-proxy.<你的 workers.dev 子網域>.workers.dev`

前端 Proxy URL 應填：

`https://exam-cleaner-proxy.<你的 workers.dev 子網域>.workers.dev/api/clean`

前端存取權杖填入 `EXAM_CLEANER_ACCESS_TOKEN` 的值。

## 第五步：Alpha.5 驗證

在 Alpha.5 選擇「OpenAI 安全 Proxy」，填入 Proxy URL 與存取權杖後按「測試 OpenAI Proxy 與權杖」。此測試只呼叫 `/health` 與 `/auth-check`，不會上傳考卷，也不會呼叫 OpenAI 圖片模型。

驗證成功後，「開始 OpenAI 去筆跡」才會啟用。

## 本機 Wrangler 部署

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ACCESS_TOKEN
npm run check
npm run deploy
```

不要使用 `vars` 保存 API Key 或存取權杖。

## 健康檢查

瀏覽器開啟：

`https://<Worker 網域>/health`

正確設定時應看到：

- `provider: "openai"`
- `ready: true`
- `model: "gpt-image-1.5"`

`ready: false` 代表 `OPENAI_API_KEY` 或 `ACCESS_TOKEN` 尚未設定。

## 安全提醒

- 不要把任何 Secret 提交到 GitHub 檔案。
- 不要把 API Key 貼在 Issue、PR、聊天或畫面截圖。
- Cloudflare API Token 應限制於單一帳號及 Workers 編輯權限。
- OpenAI Project 應設定低額度的支出上限與用量警示。
- 發現異常用量時，立即輪替 OpenAI API Key 與存取權杖。
