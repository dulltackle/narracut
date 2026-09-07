# 执行胶囊内存诊断

日常认证保留各阶段隔离、PID、临时磁盘、日志、超时及浏览器自检，但不主动耗尽内存。每次执行仍先核验 systemd 的 `MemoryMax`、`MemorySwapMax=0`、`OOMPolicy=kill` 和整组进程清理策略；属性不符合预期时阻断执行。真实项目超出内存限额时仍由内核终止，输出丢弃并返回 `CAPSULE_RESOURCE_EXCEEDED`。

内核实际执行内存限额及 OOM 结果翻译由显式专项测试覆盖：

```sh
pnpm test:capsule:oom
```

该命令在 128 MiB 胶囊中故意触发 OOM，并观察真实 systemd `Result=oom-kill` 信号。GNOME 可能因此显示“设备内存接近占满”的通知；这是诊断的预期副作用。普通 `pnpm test:unit` 会跳过此专项测试，并验证日常认证不产生该信号。

日常认证不再证明当前内核实际执行过 OOM kill；更换内核、systemd 或胶囊后端后，应显式运行此专项测试。真实项目 OOM 的系统通知仍可能出现。

原因见 [GNOME Settings Daemon 的通知实现](https://github.com/GNOME/gnome-settings-daemon/blob/gnome-46/plugins/housekeeping/gsd-systemd-notify.c)：它根据服务的 `Result=oom-kill` 发出通知，没有区分整机内存不足和胶囊自身限额。跨进程缓存只能减少通知次数，不能消除首次自检通知。
