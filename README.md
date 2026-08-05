# Exam Cleaner 考卷重製

瀏覽器內執行的考卷掃描、校正、影像增強與多頁 PDF 工具。

## 正式網站

https://william74813.github.io/exam-cleaner/

## 目前版本：v2.1.0

已完成並通過 iPhone Safari 實機測試：

- GrabCut 自動框選紙張
- 大型浮動角點手動微調
- 透視校正
- 原色、灰階增強與黑白文件模式
- 灰階增強預設輸出
- 多頁佇列、排序與 A4 PDF
- PNG 下載、列印與重新掃描

正式掃描器：

https://william74813.github.io/exam-cleaner/scanner.html

發布說明請參閱 [RELEASE-v2.1.md](RELEASE-v2.1.md)。

## 下一階段：v2.2 統一 AI 去筆跡

統一辨識並移除所有後來加上的手寫答案、批改與註記，不再區分老師或學生筆跡；原始印刷題目、文字、公式、表格、圖片與 QR Code 必須保留。

## 開發原則

1. 原始印刷內容保護優先於筆跡清除率。
2. 自動框選失敗時必須保留可用的手動微調流程。
3. AI 輸出在列印前必須人工覆核。
4. 不在公開前端保存共用 API Key。
5. 已通過驗收的 v2.1 角點演算法不再任意修改。

## Roadmap

請參閱 [ROADMAP.md](ROADMAP.md)。
