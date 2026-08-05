# Exam Cleaner v2.1 正式版

發布日期：2026-08-05

## 已完成

- GrabCut 中央紙張偵測
- 自動四角框選
- iPhone Safari 浮動角點微調
- 透視校正
- 原色、灰階增強與黑白文件模式
- 灰階增強預設輸出
- 多頁佇列、排序與 A4 PDF
- PNG 下載、直接列印與重新掃描

## 已驗收環境

- iPhone Safari 實機
- 一般白色考卷、陰影與皺折照片
- 自動偵測後手動微調流程

## 使用限制

- 自動偵測以接近正確為目標，邊緣陰影、紙張彎曲或背景接近紙色時仍可能需要拖曳微調。
- 首次開啟需連線載入 OpenCV.js 與 PDF 模組。
- v2.1 僅處理掃描、校正與影像增強；統一 AI 去筆跡列入 v2.2。

## 鎖定模組

- `preview/v2.1/detect-grabcut-v1.js`
- `preview/v2.1/touch-corner-handles-v1.js`
- `preview/v2.1/enhance-v1.js`
- `preview/v2.1/default-gray-v1.js`
- `preview/v2.1/multipage-v1.js`
