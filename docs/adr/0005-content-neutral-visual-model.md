# Visual 只描述渲染能力，不记录内容用途

项目从 DSL V2 起只保留 `Card`、`Image` 和 `Video` 三种 Visual Type。Card 是不依赖 Asset 的结构化 Text Block；Image 与 Video 可以拥有一个只含正文的可选 Caption。DSL 不再用 `Title`、`EndCard`、`Image+Caption`、`Video+Caption`、`Step` 或 `Alert` 表达叙事位置和内容用途，也不保存步骤编号，因为这些分类会把特定内容领域固化进核心模型。

## Considered Options

- **保留六种 Visual Type 和 Step/Alert**——被否。Caption 是否存在不是新的渲染媒介，Step/Alert 也无法覆盖未来内容领域。
- **只保留 Image 与 Video**——被否。这样所有文字画面都必须先制作外部 Asset，失去系统生成文字画面的能力。
- **Card、Image、Video，加可选 Caption**——采用。Card 可以出现在任意位置且数量不限；Caption 不存在时不保存空对象。

## Consequences

- Card 的 Text Block 由可选的标签、标题、正文和列表组成，其中至少一项有内容；Caption 只提供非空正文。
- V1 在内存中迁移为 V2，下一次正常保存时才写回：Title 的 device/headline/subheadline 分别进入 Card 的 label/title/body，EndCard 的 title/bullets 进入 Card 的 title/items，Step 的 name 与 Alert 的 text 进入 Caption 正文；步骤编号与内容类型被删除，Scene ID、Narration、Speech 和顺序保持不变。
- Image 与 Video 互换时保留 Caption；Image/Video 转 Card 时可把 Caption 正文无损放入 Card 正文；无法无损保留的数据只在作者确认后删除。
