# 蓝天操场（二年级）· 交接

## ⏯️ 目前做到哪
2026-10-10：方案老师已确认（7 个动作、蓝天操场水彩、手机直放）。代码骨架从一年级复制并改完：7 个动作的判定与人形轮廓、蓝天配色与背景、打卡卡、语音 72 句已录。单元测试 84 项、e2e（手机＋横屏假摄像头）0 失败。**还没发布**：没建 git／Vercel 项目。

## 🚦 目前状态
- 可在本机运行；插画还没有（走云朵后备图，丑是正常的）。
- 判定阈值全是合成数据，没经真人。

## ➡️ 下一步
1. 老师在电脑上点一遍（http://127.0.0.1:8791），说「可以发布」。
2. 老师跑 cx 生 13 张图（`img-src/PROMPT-cx.md`）＋封面（`PROMPT-cx-cover.md`），然后 `python3 build-img.py`、重跑 e2e。
3. 上线：`gh repo create kongsi-idea/tahun2-pj-pergerakan` → `vercel link --scope kongsi-idea` → 部署 → `set-vercel-secret.py` ＋ `add-actions.sh` → Hub 登记（照 `tahun1-pj-pergerakan` 条目）→ 缩图（横式截正式网址）→ `npm run check -- tahun2-pj-pergerakan`。
4. 手机 iPhone 实测（摄像头工具必须）。

## ⚠️ 注意事项
- 命名规则：slug 统一 `tahunN-pj-pergerakan`（分类用）；学生看到的名称各年级自取、要吸引人（一年级「动物模仿秀」，二年级「蓝天操场」，**名称是否定案：待老师确认**）。
- 本机测试：8791 留给老师，自动测试用 8792。

## 🕐 最后更新
2026-10-10 · Claude Code (Sonnet 5.5)
