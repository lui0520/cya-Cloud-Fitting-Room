材料貼圖資料夾
================

放下方材料（options.json 的 "materials"）要顯示的貼圖，PNG 或 GIF 都可以。

對應方式：
  options.json 裡每個材料的 "icon" 欄位指向這裡的檔案，例如
    { "id": "rabbit", "name": "兔子", "icon": "icons/rabbit" }
  不寫副檔名時會依序找 icons/rabbit.gif、icons/rabbit.png。

  沒寫 "icon" 欄位時，預設找 icons/<材料 id>，
  所以檔名跟材料 id 一樣（例如 rabbit.png）就不用另外設定。

  找不到貼圖時只顯示材料名稱。

建議：
  - 正方形、透明背景，256x256 左右就夠用（按鈕上顯示約 48px）。
