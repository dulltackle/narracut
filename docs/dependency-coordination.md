# 候选依赖协调

`coordinate_project_dependencies` 是修改候选 `package.json`、`pnpm-lock.yaml` 与项目离线依赖库的唯一插件工具。调用前显式创建候选并读取 `baseline`；普通候选 `apply` 不能修改依赖文件。

```json
{
  "projectDirectory": "/绝对路径/项目",
  "projectId": "项目身份",
  "baseline": "读取候选得到的基线",
  "dependencies": { "包名": "1.2.3" },
  "packages": [
    { "name": "包名", "version": "1.2.3", "integrity": "sha512-公共registry提供的规范Base64摘要" }
  ]
}
```

## 选择版本

`dependencies` 合并到现有直接依赖；`packages` 为新增或更新的包提供精确版本和 SHA-512，已有锁图里的精确包可以复用。传递依赖与 peer 依赖也需要满足包声明的精确选择；缺少选择时报错，不查询或猜测最新版本。

同名包可以提供多个精确版本；优先使用兼容的直接依赖，否则在已固定版本中确定性选择。只提交实际需要的包，使用固定公共 npm registry，Remotion 包与 Runtime 保持同版；不传凭据、私有来源或范围形式的直接版本。来源与离线规则见[规范第 9.2 节](spec/project-vnext.md#92-依赖规则)。

## 缺包与失败处理

打开、构建、Preview、Render 和回退均不自动补包或改锁。缺失或损坏的离线包必须通过本工具显式修复；首次协调同时补齐候选、恢复检查点与保留修订所需的包。放弃候选后离线库仍保留，当前实现不回收包。

协调失败后重新读取候选状态与基线，再按具体诊断修复或重试。现有 pnpm peer 上下文锁图可以只读消费，但同一包版本存在多个上下文时会拒绝；不要为了构建直接改写已接受修订的锁文件。

解析与协调实现见[依赖模块](../src/server/project-dependencies.ts)；验证见[依赖测试](../tests/project-dependencies.test.ts)与[跨阶段联验](../tests/dependency-execution-verification.test.ts)。真实执行所需环境见[执行胶囊](execution-capsule.md#入口与认证)。
