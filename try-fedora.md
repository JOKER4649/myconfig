# Fedora Workstation 雙系統安裝計畫

> 目標：在單顆 SSD 上安裝 Ubuntu + Fedora 雙系統，保留隨時切換的能力。

## 目前系統狀態

```
磁碟：Kingston SA400S37960G（960GB SSD）
├─ sda1   1G    vfat    /boot/efi     (EFI System Partition)
└─ sda2  893G   ext4    /             (已用 266G，可用 568G，32%)

Swap：/swap.img 32G（swap file，位於根分區）
RAM：  32G

Zswap：啟用（zstd 壓縮，zsmalloc，上限 20% 記憶體）
       zswap 需要 swap file 作為後端，刪除 swap file 前 zswap 快取會 flush 回記憶體

USB：/dev/sdb（29.4G Flash Disk，目前為 Linux Mint 安裝碟）
```

## 目標分區方案

```
sda                           960G
├─ sda1    1G    vfat         /boot/efi      (共用 EFI，不格式化)
├─ sda2  ~445G   ext4         /              (Ubuntu，縮減後保留)
├─ sda3    1G    ext4         /boot          (Fedora boot)
└─ sda4  ~443G   btrfs        /              (Fedora root)
```

- 不建立獨立 swap 分區：Fedora Workstation 預設使用 zram（壓縮記憶體 swap），32G RAM 不需要磁碟 swap
- Fedora root 使用 btrfs：支援快照與一鍵回滾系統更新
- Fedora /boot 使用 ext4：標準且穩定

---

## 執行步驟

### 步驟 1：備份 EFI 分區（在 Ubuntu 中執行）

```bash
sudo cp -r /boot/efi/EFI ~/efi_backup
```

- 這是安全網。如果安裝過程中 EFI 分區意外被覆寫，可以從備份還原
- 完成 Fedora 安裝且確認雙系統正常開機後可刪除此備份

### 步驟 2：下載 Fedora Workstation ISO

- 前往 https://fedoraproject.org/workstation/download/ 下載最新版 ISO
- 寫入計畫時 Fedora 最新為 42，請以官網實際版本為準
- ISO 約 2.2GB

### 步驟 3：燒錄 Fedora ISO 到 USB 隨身碟

```bash
# 確認 USB 隨身碟位置
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS | grep -v loop

# 卸載 USB 所有分區
sudo umount /dev/sdb1 /dev/sdb3

# 燒錄 ISO（這會銷毀 USB 上所有資料）
sudo dd bs=4M if=/tmp/Fedora-Workstation-Live-x86_64-*.iso of=/dev/sdb conv=fsync status=progress
sync
```

⚠️ **注意**：
- 確認 `/dev/sdb` 確實是 USB 隨身碟，**不是**內部 SSD（`/dev/sda`）
- `of=/dev/sdb` 是整個裝置，不是 `/dev/sdb1`（不加分割區編號）
- 燒錄完成後 USB 上原本的 3 個分區會被 ISO 內容取代

### 步驟 4：停用 Ubuntu 的 swap file（在 Ubuntu 中執行）

```bash
# 停用 swap（zswap 快取會先 flush 回記憶體，然後 swap 中的資料會被釋放）
sudo swapoff /swap.img

# 確認 swap 已停用
free -h
# Swap 應顯示全為 0

# 刪除 swap file（必須刪除，否則 GParted 可能無法縮減分區）
sudo rm /swap.img

# 暫時註解 fstab 中的 swap 行（保留內容供之後恢復）
sudo sed -i 's|^\(/swap.img.*\)|#\1|' /etc/fstab

# 確認 fstab 已註解
grep swap /etc/fstab
```

⚠️ **為什麼必須刪除 swap file？**
- ext4 檔案會散佈在磁碟各處，32G 的 swap file 可能在分區尾端
- GParted 縮減分區時從尾部切除，如果 swap file 在尾端就無法縮減
- zswap 的設定在 kernel cmdline，不依賴 swap file 存在，重建後自動恢復

### 步驟 5：Fedora Live USB 開機 → GParted 縮減 Ubuntu 分區

1. 重開機，進入 BIOS/UEFI 開機選單（通常按 F12 或 Esc）
2. 選擇 USB 隨身碟開機
3. 在 Fedora Live 環境中安裝 GParted（Fedora Live 預設只有 GNOME Disks，GParted 更適合縮減操作）：
   ```bash
   sudo dnf install -y gparted
   ```
4. 開啟 GParted，選擇 `/dev/sda2`（Ubuntu 根分區）
5. 縮減到約 **445G**（從尾部切除，釋放約 448G 未配置空間）
   - GParted 會自動處理 ext4 區塊搬移，刪除 swap file 後留下的碎片不需額外處理
6. 套用變更

⚠️ **注意**：縮減操作不可中斷，確保電源穩定。

### 步驟 6：安裝 Fedora Workstation

1. 在 Fedora Live 環境中執行安裝程式（桌面上的 "Install to Hard Drive"）
2. 選擇語言、鍵盤等基本設定
3. **Installation Destination** → 選擇 `/dev/sda` → "I will configure partitioning"（手動分區）
4. 在釋放出的未配置空間中建立：

   | 掛載點 | 大小 | 檔案系統 | 備註 |
   |--------|------|----------|------|
   | `/boot/efi` | — (使用現有 sda1) | vfat | **掛載但不格式化** |
   | `/boot` | 1G | ext4 | 新建 sda3 |
   | `/` | 剩餘空間 (~443G) | btrfs | 新建 sda4 |

5. **⚠️ 最關鍵的操作**：
   - 點選現有的 `sda1`（1G vfat），將掛載點設為 `/boot/efi`
   - **絕對不要勾選「格式化」（Format）**，這會毀掉 Ubuntu 的開機記錄
   - 只在新建的 sda3、sda4 勾選格式化
6. 確認無誤後開始安裝
7. 安裝完成後重開機

### 步驟 7：確認雙系統開機

1. 重開機後應該會看到 GRUB 開機選單，列出 Fedora 和 Ubuntu
2. 分別進入兩個系統確認都能正常開機

**如果 GRUB 選單沒有 Ubuntu**，進入 Fedora 後執行：

```bash
# 啟用 os-prober（現代 GRUB 預設停用）
echo 'GRUB_DISABLE_OS_PROBER=false' | sudo tee -a /etc/default/grub
sudo grub2-mkconfig -o /boot/grub2/grub.cfg

# 確認輸出中有 "Found Ubuntu" 之類的文字
```

### 步驟 8：回到 Ubuntu 重建 swap file

```bash
# 重建 swap file
sudo fallocate -l 32G /swap.img
sudo chmod 600 /swap.img
sudo mkswap /swap.img
sudo swapon /swap.img

# 取消 fstab 中 swap 行的註解
sudo sed -i 's|^#\(/swap.img.*\)|\1|' /etc/fstab

# 確認 fstab 正確
grep swap /etc/fstab

# 確認 zswap 仍在運作
cat /proc/cmdline | tr ' ' '\n' | grep zswap
# 應顯示：zswap.enabled=1 zswap.compressor=zstd zswap.zpool=zsmalloc zswap.max_pool_percent=20

# 確認 swap 啟用
free -h
```

### 步驟 9：Fedora 環境設定

```bash
# 安裝基本系統工具
sudo dnf update -y
sudo dnf install -y git vim

# 同步 myconfig 設定
git clone <your-repo-url> ~/myconfig
python ~/myconfig/link.py --apply

# 安裝 mise 和所有開發工具
# 參考 mise/config.toml 中的工具清單
curl https://mise.run | sh
mise install
```

---

## 風險與注意事項

### 高風險

| 風險 | 影響 | 防範 |
|------|------|------|
| 意外格式化 EFI 分區（sda1） | Ubuntu 無法開機 | 步驟 1 備份；安裝時反覆確認不勾格式化 |
| 縮減分區時斷電 | 資料損毀 | 確保電源穩定；筆電請接上充電器 |

### 中風險

| 風險 | 影響 | 防範 |
|------|------|------|
| GRUB 找不到 Ubuntu | 只能進 Fedora | 步驟 7 的 os-prober 修正指令 |
| swap file 在分區尾端無法縮減 | 縮減失敗 | 步驟 4 確實刪除 swap file |

### 低風險

| 風險 | 影響 | 防範 |
|------|------|------|
| Fedora ISO 版本錯誤 | 下載失敗 | 步驟 2 以官網實際版本為準 |
| USB 隨身碟辨識錯誤 | 寫入錯誤磁碟 | 執行 dd 前用 lsblk 再次確認 |

### 已確認安全的項目

| 項目 | 說明 |
|------|------|
| EFI 分區 1G 足夠 | Fedora 將 kernel 存放在獨立的 /boot 分區，不佔用 EFI 空間。Ubuntu 和 Fedora 使用各自獨立的 EFI 目錄（`EFI/ubuntu` 和 `EFI/fedora`） |
| fallocate 建立 swap file | 在 ext4 上完全安全，是標準做法 |
| Secure Boot 共存 | Ubuntu 和 Fedora 各有獨立的 signed shim，互不衝突 |
| swap file 碎片 | 刪除 swap file 後 GParted 會自動處理 ext4 區塊搬移，不需要手動 e4defrag |

---

## 時間軸建議

| 時間 | 目標 |
|------|------|
| 第 1 週 | 基本桌面體驗、輸入法測試（GNOME + IBus/fcitx5） |
| 第 2 週 | 開發工具遷移（mise install、myconfig symlink） |
| 第 3 週 | 日常工作全在 Fedora 上 |
| 第 4 週 | 決定去留：滿意 → 移除 Ubuntu；不滿意 → 移除 Fedora |

## 移除 Fedora（如果不需要了）

1. 從 Ubuntu Live USB 開機
2. 用 GParted 刪除 sda3、sda4
3. 將 sda2 擴展回收空間
4. 重建 GRUB（chroot 需要綁定必要的虛擬檔案系統）：
   ```bash
   sudo mount /dev/sda2 /mnt
   sudo mount /dev/sda1 /mnt/boot/efi
   for i in /dev /dev/pts /proc /sys /run; do sudo mount -B $i /mnt$i; done
   sudo chroot /mnt grub-install /dev/sda
   sudo chroot /mnt update-grub
   ```
5. 確認 Ubuntu 正常開機後，刪除 `~/efi_backup`

## 移除 Ubuntu（如果決定留在 Fedora）

⚠️ **此操作從已安裝的 Fedora 系統中執行**（不需要 Live USB）。btrfs 支援線上添加裝置。

1. 從 Fedora 開機進入已安裝的系統
2. 備份 Ubuntu 分區中需要的資料：
   ```bash
   # 掛載 Ubuntu 分區以便存取資料
   sudo mkdir -p /mnt/ubuntu
   sudo mount /dev/sda2 /mnt/ubuntu
   # 複製需要的檔案到 Fedora
   cp -r /mnt/ubuntu/home/joker/需要保留的資料 ~/
   sudo umount /mnt/ubuntu
   ```
3. 用 GNOME Disks 或 GParted 刪除 sda2，在同一位置建立新的未格式化分區（會重新建立為 sda2）
4. 將新分區加入 btrfs pool（`-f` 強制覆寫殘留的 ext4 簽名）：
   ```bash
   sudo btrfs device add -f /dev/sda2 /
   sudo btrfs filesystem balance /
   ```
   - 不需要刪除 sda4，btrfs 會將兩個分區無縫合併（JBOD），總容量 ~888G
   - `balance` 會自動將資料和 metadata 重新分配到所有裝置上
5. 更新 GRUB 移除 Ubuntu 開機項：`sudo grub2-mkconfig -o /boot/grub2/grub.cfg`
