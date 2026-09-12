import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** 观察 GNOME 内存通知使用的真实 systemd 信号，不依赖胶囊自报状态。 */
export async function observeCapsuleServiceResults(action: () => Promise<void>): Promise<string[]> {
  const monitor = spawn('/usr/bin/dbus-monitor', ['--session',
    "type='signal',sender='org.freedesktop.systemd1',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.freedesktop.systemd1.Service'",
  ], { env: { PATH: '/usr/bin:/bin', DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid!()}/bus` } });
  let signals = '';
  monitor.stdout.on('data', bytes => { signals += bytes.toString(); });
  monitor.stderr.resume();
  const closed = new Promise<void>(resolve => monitor.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('systemd 信号监听器启动超时')), 5000);
      monitor.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      monitor.once('error', error => { clearTimeout(timeout); reject(error); });
      monitor.once('exit', () => { clearTimeout(timeout); reject(new Error('systemd 信号监听器提前退出')); });
    });
    await action();
    // 等待总线中已发送的属性变更到达监听进程。
    await delay(300);
    if (monitor.exitCode !== null) throw new Error('systemd 信号监听器提前退出');
    return signals.split(/(?=signal time=)/)
      .filter(signal => signal.includes('narracut_2dcapsule_2d'))
      .flatMap(signal => [...signal.matchAll(/string "Result"\s+variant\s+string "([^"]+)"/g)].map(match => match[1]));
  } finally {
    monitor.kill();
    await closed;
  }
}
