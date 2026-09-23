(() => {
  "use strict";

  const STORE = "kinetic-life-os:data:v1";
  const RESET_MARKER = `${STORE}:cleared`;
  const pad = (value) => String(value).padStart(2, "0");
  const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromKey = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const todayKey = () => keyOf(new Date());
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
  const dayText = (key) => {
    const date = fromKey(key);
    return `${date.getMonth() + 1}月${date.getDate()}日 周${"日一二三四五六"[date.getDay()]}`;
  };
  const addDays = (key, amount) => {
    const date = fromKey(key);
    date.setDate(date.getDate() + amount);
    return keyOf(date);
  };
  const weekKeys = (anchor = new Date()) => {
    const monday = new Date(anchor);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return keyOf(date);
    });
  };

  function icon(name) {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/>',
      work: '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/>',
      health: '<path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8z"/>',
      fitness: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
      tasks: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
      event: '<path d="M5 21V4"/><path d="M5 5h11l-2 4 2 4H5"/>',
      settings: '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
    };
    return `<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.home}</svg>`;
  }

  function smileyLogoMarkup() {
    return '<svg class="logo-face" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 20l9 7-9 7M54 20l-9 7 9 7M25 39c3 6 11 6 14 0"/></svg>';
  }

  const pages = [
    ["home", "总览", "home"],
    ["work", "工作计划", "work"],
    ["health", "健康管理", "health"],
    ["fitness", "健身计划", "fitness"],
    ["reminders", "日常提醒", "tasks"],
    ["calendar", "日历看板", "event"],
    ["settings", "设置与备份", "settings"]
  ];
  const pageNames = Object.fromEntries(pages.map(([id, label]) => [id, label]));

  document.body.innerHTML = `
    <a class="skip-link" href="#v2Main">跳到主要内容</a>
    <div class="v2-shell">
      <aside class="v2-sidebar">
        <div class="v2-brand"><span class="v2-logo" aria-hidden="true">${smileyLogoMarkup()}</span><div><strong>个人工作台</strong><span>LIFE OS · 本地版</span></div></div>
        <nav class="v2-nav" aria-label="主导航">
          ${pages.map(([id, label, iconName]) => `<a href="#${id}" data-page="${id}">${icon(iconName)}<span>${label}</span></a>`).join("")}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-save">修改会自动保存在当前浏览器</div>
      </aside>

      <main class="v2-main" id="v2Main">
        <header class="v2-topbar">
          <div class="v2-topbar-brand"><span class="v2-mobile-logo" aria-hidden="true">${smileyLogoMarkup()}</span><div class="v2-crumb" id="pageCrumb">总览</div></div>
          <div class="v2-top-actions">
            <label class="search-field">
              <span class="sr-only">搜索项目</span>
              ${icon("search")}
              <input class="input" id="globalSearch" type="search" placeholder="搜索项目…" />
            </label>
          </div>
        </header>

        <div class="v2-content">
          <section class="v2-screen" data-screen="home">
            <div class="compact-banner"><h2>生活总览</h2></div>
            <section class="section grid home-top">
              <div class="home-left-stack">
                <article class="card">
                  <div class="card-head"><div><h3>近期重点</h3><small>当前阶段的行动、目的与下一步</small></div><button class="text-btn" data-action="toggle-priority-edit">编辑</button></div>
                  <div id="homePriorities"></div>
                </article>
                <article class="card calendar-card compact-home-calendar">
                  <div class="card-head"><div><h3>日历</h3><small>选择日期查看当天概况</small></div><button class="text-btn" data-page="calendar">打开日历看板</button></div>
                  <div class="calendar-head"><span class="calendar-month" id="homeCalendarMonth"></span><div class="calendar-controls"><button class="date-nav-btn" data-action="home-prev-month" aria-label="上个月">‹</button><button class="date-nav-btn" data-action="home-next-month" aria-label="下个月">›</button></div></div>
                  <div class="weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
                  <div class="calendar-grid" id="homeCalendarGrid"></div>
                  <div class="calendar-caption" id="homeCalendarCaption"></div>
                </article>
              </div>
              <article class="card progress-overview-card">
                <div class="card-head"><div><h3>进度概览</h3><small>工作推进与年度方向</small></div><button class="text-btn" data-action="toggle-goal-edit">编辑目标</button></div>
                <div class="progress-pair">
                  <div class="progress-ring-block">
                    <div class="muted">本月工作完成率</div>
                    <div class="donut compact-donut" id="monthRing" style="--p:0%"><div class="donut-inner"><strong id="monthProgress">0%</strong><span>工作事项</span></div></div>
                  </div>
                  <div class="progress-ring-block">
                    <div class="muted">年度目标完成率</div>
                    <div class="donut compact-donut" id="overallRing" style="--p:0%"><div class="donut-inner"><strong id="overallProgress">0%</strong><span>平均进度</span></div></div>
                  </div>
                </div>
                <div class="goal-divider"><strong>年度目标</strong><span>位于本月工作进度下方</span></div>
                <div id="homeGoals" tabindex="0" aria-label="年度目标列表"></div>
              </article>
            </section>

            <section class="section grid quick-links">
              <button class="card quick-link" data-page="reminders">${icon("tasks")}<strong>日常提醒</strong><small>待办、重要事项与日期</small></button>
              <button class="card quick-link" data-page="health">${icon("health")}<strong>健康</strong><small>体重、饮食与饮水</small></button>
              <button class="card quick-link" data-page="fitness">${icon("fitness")}<strong>健身</strong><small>查看当天训练安排</small></button>
              <button class="card quick-link" data-page="work">${icon("work")}<strong>项目</strong><small>推进记录与历史</small></button>
            </section>

            <section class="section">
              <div class="section-head"><div><h3>今天要做</h3><p>可直接修改，内容与日常提醒、日历同步。</p></div><button class="btn secondary" data-page="reminders">打开日常提醒</button></div>
              <div class="grid grid-3" id="homeTasks"></div>
            </section>
          </section>

          <section class="v2-screen" data-screen="work">
            <div class="page-heading"><h2>项目推进</h2><p>管理工作与长期项目，记录每一次推进，并随时回看完整历史。</p></div>
            <section class="section"><article class="card"><div class="card-head"><div><h3>项目总进度</h3><small>与下方项目状态和进度实时同步</small></div></div><div class="project-overview" id="projectOverview"></div></article></section>
            <section class="section">
              <div class="section-head"><div><h3>正在推进</h3><p>状态、进度和下一步会自动保存。</p></div><button class="btn green" data-action="add-project">＋ 新项目</button></div>
              <div class="project-list" id="projectList"></div>
            </section>
          </section>

          <section class="v2-screen" data-screen="health">
            <div class="page-heading"><h2>健康记录</h2><p>记录体重、饮水、饮食与每日状态，重点观察连续变化。</p></div>
            <section class="section grid health-layout">
              <article class="card">
                <div class="card-head"><div><h3>体重趋势</h3><small>按日期形成折线趋势</small></div></div>
                <div class="line-chart-wrap" id="weightChart"></div>
                <form class="form-row" id="weightForm">
                  <label class="sr-only" for="weightInput">今日体重，单位千克</label>
                  <input class="input" id="weightInput" type="number" step="0.1" min="0" inputmode="decimal" placeholder="今日体重（kg）" required />
                  <button class="btn green" type="submit">记录</button>
                </form>
              </article>
              <article class="card">
                <div class="card-head"><div><h3>今日状态</h3><small id="healthDateLabel"></small></div></div>
                <div class="field"><label for="moodInput">心情</label><select class="select" id="moodInput"><option value="">尚未记录</option><option>很好</option><option>平稳</option><option>一般</option><option>低落</option></select></div>
                <div class="field" style="margin-top:12px"><label for="energyInput">精力</label><select class="select" id="energyInput"><option value="">尚未记录</option><option>充足</option><option>正常</option><option>偏低</option><option>疲惫</option></select></div>
                <div class="field" style="margin-top:12px"><label for="calorieInput">饮食热量（可选）</label><input class="input" id="calorieInput" type="number" min="0" inputmode="numeric" placeholder="例如：1800" /></div>
                <button class="btn secondary" data-action="save-health" style="margin-top:14px">保存状态</button>
              </article>
            </section>
            <section class="section grid grid-2">
              <article class="card">
                <div class="card-head"><div><h3>今日饮水</h3><small>每杯按约 250 毫升估算</small></div><span class="tag blue" id="waterLabel">0 / 8 杯</span></div>
                <div class="water-meter" id="waterMeter"></div>
                <div class="form-row"><button class="btn green" data-action="water-plus">＋ 记录一杯</button><button class="btn secondary" data-action="water-minus">减少一杯</button></div>
              </article>
              <article class="card">
                <div class="card-head"><div><h3>饮食简记</h3><small>记录主要食物和大致份量</small></div></div>
                <label class="sr-only" for="foodInput">饮食简记</label>
                <textarea class="textarea" id="foodInput" placeholder="早餐：……&#10;午餐：……&#10;晚餐：……"></textarea>
                <button class="btn secondary" data-action="save-food" style="margin-top:10px">保存饮食记录</button>
              </article>
            </section>
          </section>

          <section class="v2-screen" data-screen="fitness">
            <div class="page-heading"><h2>健身计划</h2><p>示例模板包含力量、有氧与恢复安排；请根据自己的身体状态调整。</p></div>
            <section class="section grid grid-3" id="fitnessStats"></section>
            <section class="section grid grid-2">
              <article class="card">
                <div class="card-head"><div><h3>每日安排</h3><small>切换日期查看当天训练项目</small></div></div>
                <div class="date-strip"><button class="date-nav-btn" data-action="fitness-prev-day" aria-label="前一天">‹</button><div class="date-strip-label"><strong id="fitnessDateTitle"></strong><small id="fitnessDateHint"></small></div><button class="date-nav-btn" data-action="fitness-next-day" aria-label="后一天">›</button></div>
                <div id="fitnessDayPlan"></div>
              </article>
              <article class="card">
                <div class="card-head"><div><h3>日常健身项目</h3><small>早上激活，晚上恢复</small></div></div>
                <div class="routine-list" id="fitnessRoutines"></div>
              </article>
            </section>
            <section class="section">
              <div class="section-head"><div><h3>专项训练</h3><p>动作和建议频次保持同一行，作为现有计划的灵活补充。</p></div></div>
              <div class="grid grid-3 training-panels" id="supplementTrainingPanels"></div>
            </section>
          </section>

          <section class="v2-screen" data-screen="reminders">
            <div class="page-heading"><h2>日常提醒</h2><p>统一管理每日待办、长期事项和需要按日期跟进的工作与生活事件。</p></div>
            <section class="section grid grid-2">
              <article class="card">
                <div class="date-strip"><button class="date-nav-btn" data-action="reminder-prev-day" aria-label="前一天">‹</button><div class="date-strip-label"><strong id="reminderDateTitle"></strong><small id="reminderProgress"></small></div><button class="date-nav-btn" data-action="reminder-next-day" aria-label="后一天">›</button></div>
                <div class="todo-list" id="reminderList"></div>
                <form class="form-row" id="reminderForm" style="margin-top:14px"><label class="sr-only" for="reminderInput">添加待办</label><input class="input" id="reminderInput" maxlength="120" placeholder="添加当天待办" required /><button class="btn green" type="submit">添加</button></form>
              </article>
              <article class="card">
                <div class="card-head"><div><h3>当天记录</h3><small id="notesDateLabel"></small></div></div>
                <label class="sr-only" for="dayNotesInput">当天记录</label>
                <textarea class="textarea" id="dayNotesInput" placeholder="今天推进了什么？明天需要继续什么？"></textarea>
                <button class="btn secondary" data-action="save-day-notes" style="margin-top:10px">保存记录</button>
              </article>
            </section>
            <section class="section grid important-layout">
              <article class="card">
                <div class="card-head"><div><h3>长期待办清单</h3><small>不限定某一天的重要事项</small></div><span class="tag" id="masterTodoProgress">0 / 0</span></div>
                <div class="master-todo" id="masterTodoList"></div>
                <form class="form-grid" id="masterTodoForm" style="margin-top:16px">
                  <div class="field"><label for="masterTodoTitle">事项</label><input class="input" id="masterTodoTitle" maxlength="100" placeholder="添加一项待办" required /></div>
                  <div class="field"><label for="masterTodoNote">补充说明</label><input class="input" id="masterTodoNote" maxlength="160" placeholder="可选" /></div>
                  <div class="wide"><button class="btn green" type="submit">添加待办</button></div>
                </form>
              </article>
              <article class="card">
                <div class="card-head"><div><h3>重要日期</h3><small>需要提前准备或按时跟进</small></div><button class="text-btn" data-action="toggle-event-form">＋ 添加</button></div>
                <div class="event-list" id="eventList"></div>
                <form class="form-grid" id="eventForm" hidden style="margin-top:16px">
                  <div class="field"><label for="eventDateInput">日期</label><input class="input" id="eventDateInput" type="date" required /></div>
                  <div class="field"><label for="eventTitleInput">事项名称</label><input class="input" id="eventTitleInput" maxlength="80" required /></div>
                  <div class="field wide"><label for="eventCopyInput">补充说明</label><textarea class="textarea" id="eventCopyInput" maxlength="200"></textarea></div>
                  <div class="wide form-row"><button class="btn green" type="submit">保存日期</button><button class="btn secondary" type="button" data-action="toggle-event-form">取消</button></div>
                </form>
              </article>
            </section>
          </section>

          <section class="v2-screen" data-screen="calendar">
            <div class="page-heading"><h2>日历看板</h2><p>选择日期后，集中查看当天计划、运动、状态、饮水、体重和项目推进。</p></div>
            <section class="section calendar-stack">
              <article class="card calendar-card calendar-overview-card">
                <div class="calendar-overview-grid">
                  <div class="calendar-compact-pane">
                    <div class="calendar-head"><span class="calendar-month" id="calendarMonth"></span><div class="calendar-controls"><button class="date-nav-btn" data-action="prev-month" aria-label="上个月">‹</button><button class="date-nav-btn" data-action="today" aria-label="回到今天">今</button><button class="date-nav-btn" data-action="next-month" aria-label="下个月">›</button></div></div>
                    <div class="weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
                    <div class="calendar-grid" id="calendarGrid"></div>
                    <div class="calendar-caption" id="calendarCaption"></div>
                    <div class="day-summary calendar-day-summary" id="calendarDaySummary"></div>
                  </div>
                  <div class="calendar-health-pane day-dashboard" id="calendarHealthPanel"></div>
                </div>
              </article>
              <div class="calendar-detail-grid">
                <article class="card day-dashboard" id="calendarWorkoutPanel"></article>
                <article class="card day-dashboard" id="calendarWorkPanel"></article>
              </div>
            </section>
          </section>

          <section class="v2-screen" data-screen="settings">
            <div class="page-heading"><h2>设置与备份</h2><p>数据仅保存在当前浏览器，请定期导出备份。</p></div>
            <section class="section settings-stack">
              <article class="card settings-card"><h3>数据备份</h3><p>导出 JSON 备份后，可以在另一台设备恢复工作台数据。</p><div class="settings-actions"><button class="btn green" data-action="export">导出备份</button><label class="btn secondary file-btn">导入备份<input id="importInput" type="file" accept="application/json,.json" aria-label="选择备份文件" /></label></div></article>
              <article class="card settings-card"><h3>清除当前设备记录</h3><p>此操作会清除当前浏览器中的工作台记录，且无法撤销。</p><div class="settings-actions"><button class="btn danger" data-action="reset">清除全部记录</button></div></article>
            </section>
          </section>

          <p class="v2-footer">KINETIC LIFE OS · 本地保存</p>
        </div>
      </main>
    </div>
    <nav class="mobile-nav-v2" aria-label="移动端导航">
      ${pages.slice(0, 4).concat([pages[5]]).map(([id, label, iconName]) => `<a href="#${id}" data-page="${id}">${icon(iconName)}<span>${label.replace("计划", "")}</span></a>`).join("")}
    </nav>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;

  const routineData = [
    ["stand", "早晨呼吸与伸展", "用 5–10 分钟唤醒身体。"],
    ["jingang", "今日重点确认", "写下今天最重要的一件事。"],
    ["longevity", "晚间轻松活动", "散步或完成温和活动。"],
    ["back", "全身放松拉伸", "保持动作轻柔并避免疼痛。"],
    ["face", "睡前放松", "减少屏幕刺激，为睡眠做准备。"]
  ];

  const workoutPlans = {
    1: {
      title: "力量 A",
      subtitle: "肩背与手臂 · 全站立 · 不超过 60 分钟",
      items: [
        ["热", "热身 6–8 分钟", "绕肩、肩胛活动、胸椎旋转与手腕活动"],
        ["1", "站姿哑铃肩推", "4 × 8–12"],
        ["2", "站姿哑铃侧平举", "4 × 10–15"],
        ["3", "站姿单臂哑铃划船", "4 × 10–12 / 侧"],
        ["4", "站姿俯身反向飞鸟", "4 × 12–15"],
        ["5", "站姿哑铃弯举", "3 × 10–12"],
        ["6", "保加利亚分腿蹲", "2 × 10–12"],
        ["7", "站姿靠墙滑手", "3 × 8–12"],
        ["伸", "拉伸 5–8 分钟", "胸肌、背阔肌与前臂"]
      ]
    },
    2: {
      title: "有氧 A",
      subtitle: "低冲击有氧、肩背胸椎与手腕 · 约 50–58 分钟",
      items: [
        ["1", "低冲击有氧", "快走、坡度走、骑行或游泳 · 25–30 分钟"],
        ["2", "肩背与胸椎灵活", "绕肩、肩胛前伸后缩、靠墙滑手、胸椎旋转 · 10–12 分钟"],
        ["3", "手腕与小关节", "屈伸、旋前旋后、手指张合、前臂放松 · 8–10 分钟"]
      ]
    },
    3: {
      title: "力量 B",
      subtitle: "臀腿、骨盆控制与核心 · 不超过 60 分钟",
      items: [
        ["热", "热身 6–8 分钟", "髋、踝活动与徒手深蹲"],
        ["1", "哑铃深蹲", "4 × 10–12"],
        ["2", "臀桥", "4 × 12–15"],
        ["3", "哑铃罗马尼亚硬拉", "4 × 10–12"],
        ["4", "扶墙辅助静态分腿蹲", "3 × 8–12 / 侧"],
        ["5", "保加利亚分腿蹲", "2 × 10–12"],
        ["6", "平板支撑", "30–60 秒"],
        ["7", "死虫式", "3 × 8–10 / 侧"],
        ["伸", "拉伸 5–8 分钟", "髋屈肌、臀部与大腿后侧"]
      ]
    },
    4: {
      title: "恢复日",
      subtitle: "身体维护或轻松走动",
      items: [["1", "轻松走动", "按当天状态安排 15–30 分钟"], ["2", "日常维护", "完成早晚练习即可"]]
    },
    5: {
      title: "力量 C",
      subtitle: "背部稳定、臀部与后链 · 不超过 60 分钟",
      items: [
        ["热", "热身 6–8 分钟", "走步、绕肩、胸椎旋转与髋铰链"],
        ["1", "单臂哑铃划船", "4 × 10–12 / 侧"],
        ["2", "俯身反向飞鸟", "4 × 12–15"],
        ["3", "哑铃罗马尼亚硬拉", "4 × 10–12"],
        ["4", "单腿臀桥", "4 × 10–12 / 侧"],
        ["5", "超人式", "4 × 12–15"],
        ["6", "站姿单侧提重行走 / 原地抬膝", "3 × 30–45 秒 / 侧"],
        ["7", "站姿靠墙滑手", "3 × 8–12"],
        ["伸", "拉伸 5–8 分钟", "背阔肌、胸、臀部与后链"]
      ]
    },
    6: {
      title: "有氧 B",
      subtitle: "全身灵活性与稳定 · 约 50–58 分钟",
      items: [
        ["1", "低冲击有氧", "低冲击操、踏步、爬楼慢走、骑行或游泳 · 20–25 分钟"],
        ["2", "骨盆与髋踝控制", "骨盆中立呼吸、髋部转移、踝背屈、侧向迈步 · 12–15 分钟"],
        ["3", "肩背稳定", "墙天使、胸椎旋转、站姿开书式、轻柔手腕活动 · 10–12 分钟"]
      ]
    },
    0: {
      title: "休息日",
      subtitle: "充分恢复，不安排正式训练",
      items: [["1", "轻松活动", "散步或按状态完成日常维护"]]
    }
  };

  const supplementaryTraining = [
    {
      title: "稳定性及灵活性",
      note: "肩背、手腕、髋踝与身体控制",
      rows: [
        ["肩背与胸椎流动", "每周 2 次 · 10–12 分钟"],
        ["手腕与小关节活动", "每周 2–3 次 · 8–10 分钟"],
        ["骨盆与髋踝控制", "每周 2 次 · 10–15 分钟"]
      ]
    },
    {
      title: "舞蹈训练",
      note: "先从自由律动和基础协调开始",
      rows: [
        ["节奏热身与重心转移", "每周 1 次 · 8–10 分钟"],
        ["低冲击组合练习", "每周 1 次 · 15–20 分钟"],
        ["自由律动与放松", "每周 1 次 · 5–10 分钟"]
      ]
    },
    {
      title: "网球训练",
      note: "以基础步伐、挥拍协调和无痛为准",
      rows: [
        ["分腿垫步与侧向移动", "每周 1 次 · 10 分钟"],
        ["正反手空挥或对墙练习", "每周 1 次 · 15–20 分钟"],
        ["肩腕放松与拉伸", "每次结束 · 5–8 分钟"]
      ]
    }
  ];

  const emptyDay = () => ({
    tasks: [],
    notes: "",
    mood: "",
    energy: "",
    calories: "",
    food: "",
    water: 0,
    fitness: false,
    routines: { stand: false, jingang: false, longevity: false, back: false, face: false }
  });

  function defaultState() {
    const state = {
      version: 2,
      goals: [
        { id: "g-life", title: "建立稳定的生活节奏", area: "生活管理", progress: 30 },
        { id: "g-health", title: "保持规律运动与恢复", area: "健康与运动", progress: 25 },
        { id: "g-work", title: "推进一个重要工作目标", area: "工作与成长", progress: 20 },
        { id: "g-learning", title: "保持持续学习与兴趣探索", area: "学习与兴趣", progress: 15 }
      ],
      priorities: [
        { id: "priority-now", label: "现在", text: "完成本周最重要的一项任务", detail: "把任务拆成一个可以立即开始的小行动。" },
        { id: "priority-next", label: "接下来", text: "整理下一阶段计划", detail: "确认目标、截止日期和下一步。" },
        { id: "priority-later", label: "随后", text: "安排一次恢复或兴趣活动", detail: "为休息、运动和兴趣保留明确时间。" }
      ],
      projects: [
        { id: "p-work", title: "季度工作项目", symbol: "↗", area: "工作与成长", status: "进行中", progress: 25, next: "确定本周需要交付的最小成果。", logs: [] },
        { id: "p-learning", title: "学习计划", symbol: "✦", area: "学习与兴趣", status: "进行中", progress: 20, next: "完成一次专注学习并记录收获。", logs: [] },
        { id: "p-creation", title: "个人作品", symbol: "□", area: "创作与表达", status: "未开始", progress: 0, next: "先完成一个可以展示的粗糙版本。", logs: [] },
        { id: "p-home", title: "生活整理", symbol: "○", area: "生活管理", status: "长期维护", progress: 30, next: "处理一件积压已久的小事。", logs: [] }
      ],
      milestones: [
        { id: "m1", title: "完成年度目标拆解", note: "把目标拆分为季度与月度行动。", done: false },
        { id: "m2", title: "建立本月行动清单", note: "保留少量清晰、可执行的事项。", done: false },
        { id: "m3", title: "安排一次阶段复盘", note: "回顾进展并调整下一步。", done: false },
        { id: "m4", title: "留出恢复与兴趣时间", note: "把休息也视为计划的一部分。", done: false }
      ],
      events: [],
      days: {},
      weightHistory: [],
      reminders: [],
      focusSeconds: 1500,
      migratedToV2: true
    };
    const day = emptyDay();
    day.tasks = [
      { id: uid("task"), text: "推进一项当前重点", done: false, area: "工作" },
      { id: uid("task"), text: "专注学习 20 分钟", done: false, area: "学习" },
      { id: uid("task"), text: "完成运动或身体维护", done: false, area: "健康" },
      { id: uid("task"), text: "整理一个生活空间", done: false, area: "生活" }
    ];
    state.days[todayKey()] = day;
    return state;
  }

  function loadState() {
    const base = defaultState();
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!raw || typeof raw !== "object") return base;
      const merged = {
        ...base,
        ...raw,
        version: 2,
        goals: Array.isArray(raw.goals) ? raw.goals : base.goals,
        priorities: Array.isArray(raw.priorities) ? raw.priorities : base.priorities,
        projects: Array.isArray(raw.projects) ? raw.projects : base.projects,
        milestones: Array.isArray(raw.milestones) ? raw.milestones : base.milestones,
        events: Array.isArray(raw.events) ? raw.events : [],
        days: raw.days && typeof raw.days === "object" ? raw.days : {},
        weightHistory: Array.isArray(raw.weightHistory) ? raw.weightHistory : []
      };
      Object.values(merged.days).forEach(normalizeDay);
      merged.projects.forEach((project) => {
        project.logs = Array.isArray(project.logs) ? project.logs : [];
      });
      merged.priorities = merged.priorities.map((item, index) => ({
        ...(base.priorities[index] || {}),
        ...item
      }));
      if (!raw.migratedToV2 && Array.isArray(raw.reminders)) {
        const day = merged.days[todayKey()] || emptyDay();
        normalizeDay(day);
        raw.reminders.filter((item) => !item.done && item.text).forEach((item) => {
          if (!day.tasks.some((task) => task.text === item.text)) {
            day.tasks.push({ id: uid("task"), text: item.text, done: false, area: "生活" });
          }
        });
        merged.days[todayKey()] = day;
      }
      merged.migratedToV2 = true;
      return merged;
    } catch {
      return base;
    }
  }

  function normalizeDay(day) {
    if (!Array.isArray(day.tasks)) day.tasks = [];
    if (!day.routines || typeof day.routines !== "object") day.routines = emptyDay().routines;
    routineData.forEach(([id]) => {
      if (typeof day.routines[id] !== "boolean") day.routines[id] = false;
    });
    if (typeof day.water !== "number") day.water = Number(day.water) || 0;
    if (typeof day.fitness !== "boolean") day.fitness = false;
    ["notes", "mood", "energy", "calories", "food"].forEach((field) => {
      if (day[field] == null) day[field] = "";
    });
    return day;
  }

  let state = loadState();
  let selectedDate = todayKey();
  let selectedFitnessDate = todayKey();
  let monthCursor = fromKey(todayKey());
  monthCursor.setDate(1);
  let editingGoals = false;
  let editingPriorities = false;

  function ensureDay(key) {
    if (!state.days[key]) state.days[key] = emptyDay();
    return normalizeDay(state.days[key]);
  }

  function save() {
    localStorage.setItem(STORE, JSON.stringify(state));
  }

  function notify(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  function completionFor(key) {
    const tasks = state.days[key]?.tasks || [];
    const done = tasks.filter((task) => task.done).length;
    return { done, total: tasks.length, rate: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }

  function overallProgress() {
    if (!state.goals.length) return 0;
    return Math.round(state.goals.reduce((sum, goal) => sum + Math.max(0, Math.min(100, Number(goal.progress) || 0)), 0) / state.goals.length);
  }

  function projectLogsOn(key) {
    return state.projects.flatMap((project) => (project.logs || [])
      .filter((log) => log.date === key)
      .map((log) => ({ project: project.title, text: log.text })));
  }

  function weightOn(key) {
    return [...state.weightHistory].reverse().find((entry) => entry.date === key);
  }

  function eventsOn(key) {
    return state.events.filter((event) => event.date === key);
  }

  function hasDayInformation(key) {
    const day = state.days[key];
    if (!day) return eventsOn(key).length > 0 || projectLogsOn(key).length > 0 || Boolean(weightOn(key));
    return day.tasks.length > 0 || Boolean(day.notes || day.mood || day.energy || day.calories || day.food || day.water || day.fitness) ||
      Object.values(day.routines).some(Boolean) || eventsOn(key).length > 0 || projectLogsOn(key).length > 0 || Boolean(weightOn(key));
  }

  function monthGrid() {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const last = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let index = 0; index < offset; index += 1) cells.push('<div class="cal-day empty"></div>');
    for (let day = 1; day <= last; day += 1) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`;
      const stats = completionFor(key);
      const marker = stats.rate >= 60 ? "done" : hasDayInformation(key) ? "has" : "";
      cells.push(`<button class="cal-day ${key === selectedDate ? "selected" : ""} ${key === todayKey() ? "today" : ""}" data-date="${key}" aria-label="${esc(dayText(key))}" ${key === selectedDate ? 'aria-pressed="true"' : ""}><span>${day}</span><i class="cal-dot ${marker}"></i></button>`);
    }
    return { title: `${year}年${month + 1}月`, html: cells.join("") };
  }

  function renderCalendars() {
    const grid = monthGrid();
    ["home", "calendar"].forEach((kind) => {
      const month = document.getElementById(kind === "home" ? "homeCalendarMonth" : "calendarMonth");
      const target = document.getElementById(kind === "home" ? "homeCalendarGrid" : "calendarGrid");
      if (month) month.textContent = grid.title;
      if (target) target.innerHTML = grid.html;
    });
    const stats = completionFor(selectedDate);
    const summary = summaryText(selectedDate);
    const homeCaption = document.getElementById("homeCalendarCaption");
    const caption = document.getElementById("calendarCaption");
    if (homeCaption) homeCaption.innerHTML = `<strong>${esc(dayText(selectedDate))}</strong>${stats.done}/${stats.total} 项完成 · ${esc(summary)}`;
    if (caption) caption.innerHTML = `<strong>${esc(dayText(selectedDate))}</strong>${esc(summary)}`;
  }

  function summaryText(key) {
    const day = state.days[key];
    const parts = [];
    if (day?.mood) parts.push(`心情 ${day.mood}`);
    if (day?.water) parts.push(`饮水 ${day.water} 杯`);
    if (day?.fitness) parts.push("训练已完成");
    if (projectLogsOn(key).length) parts.push(`${projectLogsOn(key).length} 条项目记录`);
    return parts.join(" · ") || "暂无当天记录";
  }

  function renderHome() {
    const score = overallProgress();
    document.getElementById("overallProgress").textContent = `${score}%`;
    document.getElementById("overallRing").style.setProperty("--p", `${score}%`);

    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-`;
    let monthDone = 0;
    let monthTotal = 0;
    Object.entries(state.days).filter(([key]) => key.startsWith(monthPrefix)).forEach(([, day]) => {
      const tasks = (day.tasks || []).filter((task) => ["work", "工作"].includes(task.area));
      monthDone += tasks.filter((task) => task.done).length;
      monthTotal += tasks.length;
    });
    const monthRate = monthTotal ? Math.round((monthDone / monthTotal) * 100) : 0;
    document.getElementById("monthProgress").textContent = `${monthRate}%`;
    document.getElementById("monthRing").style.setProperty("--p", `${monthRate}%`);

    document.getElementById("homeGoals").innerHTML = editingGoals
      ? `<div class="editable-list">${state.goals.map((goal) => `
          <div class="editable-row">
            <div class="goal-edit-grid">
              <label class="field"><span class="sr-only">目标名称</span><input class="inline-input" data-goal-title="${goal.id}" value="${esc(goal.title)}" /></label>
              <label class="field"><span class="sr-only">目标进度</span><input class="inline-input" data-goal-progress="${goal.id}" type="number" min="0" max="100" value="${Number(goal.progress) || 0}" /></label>
              <button class="mini-btn danger" data-action="delete-goal" data-id="${goal.id}" aria-label="删除年度目标 ${esc(goal.title)}">×</button>
            </div>
            <label class="field"><span class="sr-only">目标领域</span><input class="inline-input" data-goal-area="${goal.id}" value="${esc(goal.area || "")}" /></label>
          </div>
        `).join("")}
        <button class="btn secondary goal-add-btn" data-action="add-goal">＋ 添加年度目标</button></div>`
      : `<div class="editable-list">${state.goals.map((goal) => `
          <div class="editable-row">
            <div class="editable-row-top"><div><strong>${esc(goal.title)}</strong><br><small>${esc(goal.area || "")}</small></div><b>${Number(goal.progress) || 0}%</b></div>
            <div class="progress-track"><span style="width:${Math.max(0, Math.min(100, Number(goal.progress) || 0))}%"></span></div>
          </div>
        `).join("")}</div>`;

    document.getElementById("homePriorities").innerHTML = editingPriorities
      ? `<div class="editable-list">${state.priorities.map((item) => `<div class="field"><span>${esc(item.label)}</span><input class="inline-input" data-priority-text="${item.id}" value="${esc(item.text)}" /><textarea class="textarea compact-textarea" data-priority-detail="${item.id}" placeholder="补充目的、背景或下一步">${esc(item.detail || "")}</textarea></div>`).join("")}</div>`
      : `<div class="priority-view">${state.priorities.map((item) => `<div class="priority-item"><small>${esc(item.label)}</small><span>${esc(item.text)}</span><p>${esc(item.detail || "")}</p></div>`).join("")}</div>`;

    const todayTasks = ensureDay(todayKey()).tasks.filter((task) => !task.done).slice(0, 3);
    document.getElementById("homeTasks").innerHTML = todayTasks.length
      ? todayTasks.map((task) => `<article class="card home-task"><div class="home-task-head"><span class="tag">${esc(task.area || "生活")}</span><label><input class="check" type="checkbox" data-task-toggle="${task.id}" data-task-date="${todayKey()}" aria-label="完成 ${esc(task.text)}" /> 完成</label></div><input class="inline-input home-task-input" data-task-text="${task.id}" data-task-date="${todayKey()}" value="${esc(task.text)}" aria-label="修改今日事项" /></article>`).join("")
      : '<div class="empty-state">今天没有未完成事项。</div>';
    renderCalendars();
  }

  function addProjectHistory(project, date, text) {
    project.logs = Array.isArray(project.logs) ? project.logs : [];
    project.logs.push({ id: uid("log"), date, text });
    project.updatedAt = date;
  }

  function renderProjects() {
    const query = (document.getElementById("globalSearch").value || "").trim().toLowerCase();
    const list = state.projects.filter((project) => !query || `${project.title}${project.area}${project.next}`.toLowerCase().includes(query));
    const overview = document.getElementById("projectOverview");
    if (overview) {
      overview.innerHTML = state.projects.length ? state.projects.map((project) => `
        <div class="project-overview-row">
          <div class="project-overview-meta"><strong>${esc(project.title)}</strong><span>${esc(project.status)} · ${Number(project.progress) || 0}%</span></div>
          <div class="progress-track" role="progressbar" aria-label="${esc(project.title)}进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(project.progress) || 0}"><span style="width:${Number(project.progress) || 0}%"></span></div>
        </div>
      `).join("") : '<div class="empty-state">还没有项目。</div>';
    }
    document.getElementById("projectList").innerHTML = list.length ? list.map((project) => {
      const logs = [...(project.logs || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return `
        <article class="card project-card">
          <div class="project-head">
            <div class="project-title"><div class="project-symbol">${esc(project.symbol || "•")}</div><div><h3>${esc(project.title)}</h3><p>${esc(project.area || "其他")} · 最近更新：${esc(project.updatedAt || "尚未记录")}</p></div></div>
            <div class="form-row">
              <select class="select" data-project-status="${project.id}" aria-label="${esc(project.title)}的状态">
                ${["未开始", "待选择", "进行中", "收尾中", "等待回复", "长期维护", "暂缓", "已完成"].map((status) => `<option ${status === project.status ? "selected" : ""}>${status}</option>`).join("")}
              </select>
              <button class="mini-btn danger" data-action="delete-project" data-id="${project.id}" aria-label="删除项目 ${esc(project.title)}">×</button>
            </div>
          </div>
          <div class="project-progress"><label><span>当前进度</span><b>${Number(project.progress) || 0}%</b></label><input type="range" min="0" max="100" value="${Number(project.progress) || 0}" data-project-progress="${project.id}" aria-label="${esc(project.title)}的进度" /></div>
          <div class="form-grid project-fields">
            <label class="field"><span>所属领域</span><input class="input" data-project-area="${project.id}" value="${esc(project.area || "")}" /></label>
            <label class="field"><span>回顾日期</span><input class="input" type="date" data-project-review="${project.id}" value="${esc(project.reviewDate || "")}" /></label>
            <label class="field wide"><span>下一步行动</span><textarea class="textarea" data-project-next="${project.id}">${esc(project.next || "")}</textarea></label>
          </div>
          <form class="log-form" data-project-log="${project.id}">
            <input class="input" type="date" data-log-date value="${todayKey()}" aria-label="记录日期" />
            <input class="input" maxlength="240" placeholder="记录一次推进" aria-label="推进记录" required />
            <button class="btn secondary" type="submit">添加记录</button>
          </form>
          <details class="history" open>
            <summary>历史记录（${logs.length}）</summary>
            ${logs.length ? logs.map((log) => `<div class="history-item"><time>${esc(log.date || "")}</time><span>${esc(log.text || "")}</span><button class="mini-btn danger" data-action="delete-project-log" data-project="${project.id}" data-id="${log.id}" aria-label="删除这条项目记录">×</button></div>`).join("") : '<div class="empty-state">还没有推进记录。</div>'}
          </details>
        </article>
      `;
    }).join("") : '<div class="empty-state">没有找到匹配的项目。</div>';
  }

  function chartSummary(data) {
    if (!data.length) return "还没有体重记录。";
    if (data.length === 1) return `当前记录为 ${data[0].weight} kg。`;
    const first = Number(data[0].weight);
    const last = Number(data[data.length - 1].weight);
    const change = Math.round((last - first) * 10) / 10;
    return `最近 ${data.length} 次记录从 ${first} kg 到 ${last} kg，变化 ${change > 0 ? "+" : ""}${change} kg。`;
  }

  function renderWeightChart(targetId, limit = 12) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const data = [...state.weightHistory]
      .filter((entry) => entry && entry.date && Number.isFinite(Number(entry.weight)))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-limit);
    if (!data.length) {
      target.innerHTML = '<div class="empty-state" style="margin-bottom:16px">还没有体重记录，记录后会在这里形成折线。</div>';
      return;
    }
    const width = 640;
    const height = 220;
    const left = 38;
    const right = 18;
    const top = 24;
    const bottom = 38;
    const values = data.map((entry) => Number(entry.weight));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const padding = Math.max(0.5, (max - min) * 0.15);
    min -= padding;
    max += padding;
    const x = (index) => data.length === 1 ? width / 2 : left + (index / (data.length - 1)) * (width - left - right);
    const y = (value) => top + ((max - value) / (max - min)) * (height - top - bottom);
    const points = data.map((entry, index) => `${x(index)},${y(Number(entry.weight))}`).join(" ");
    const gridLines = [0, 1, 2, 3].map((index) => {
      const yy = top + (index / 3) * (height - top - bottom);
      return `<line class="chart-grid" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}"/>`;
    }).join("");
    const pointNodes = data.map((entry, index) => `
      <g tabindex="0" aria-label="${esc(entry.date)}，${entry.weight} 千克">
        <circle class="chart-point" cx="${x(index)}" cy="${y(Number(entry.weight))}" r="5"><title>${esc(entry.date)} · ${entry.weight} kg</title></circle>
        <text class="chart-value" x="${x(index)}" y="${y(Number(entry.weight)) - 11}" text-anchor="middle">${entry.weight}</text>
        <text class="chart-label" x="${x(index)}" y="${height - 12}" text-anchor="middle">${esc(entry.date.slice(5))}</text>
      </g>
    `).join("");
    target.innerHTML = `
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="体重折线图。${esc(chartSummary(data))}">
        ${gridLines}
        ${data.length > 1 ? `<polyline class="chart-line" points="${points}"/>` : ""}
        ${pointNodes}
      </svg>
      <p class="chart-summary">${esc(chartSummary(data))}</p>
      <details><summary class="text-btn">查看数据表</summary><table class="data-table"><thead><tr><th>日期</th><th>体重</th></tr></thead><tbody>${data.map((entry) => `<tr><td>${esc(entry.date)}</td><td>${entry.weight} kg</td></tr>`).join("")}</tbody></table></details>
    `;
  }

  function renderHealth() {
    const day = ensureDay(todayKey());
    document.getElementById("healthDateLabel").textContent = dayText(todayKey());
    document.getElementById("moodInput").value = day.mood;
    document.getElementById("energyInput").value = day.energy;
    document.getElementById("calorieInput").value = day.calories;
    document.getElementById("foodInput").value = day.food;
    const water = Math.max(0, Math.min(8, Number(day.water) || 0));
    document.getElementById("waterLabel").textContent = `${water} / 8 杯`;
    document.getElementById("waterMeter").innerHTML = Array.from({ length: 8 }, (_, index) => `<span class="water-cup ${index < water ? "full" : ""}" aria-hidden="true"></span>`).join("");
    renderWeightChart("weightChart");
  }

  function planFor(key) {
    return workoutPlans[fromKey(key).getDay()];
  }

  function workoutMarkup(key, context) {
    const plan = planFor(key);
    const day = ensureDay(key);
    return `
      <div class="workout-overview">
        <div class="subhead"><div><strong>${esc(plan.title)}</strong><p>${esc(plan.subtitle)}</p></div><button class="btn ${day.fitness ? "green" : "secondary"}" data-action="toggle-workout" data-workout-date="${key}">${day.fitness ? "已完成" : "标记完成"}</button></div>
        <div class="workout-items">${plan.items.map(([number, title, detail]) => `<div class="workout-item"><b>${number}</b><span>${esc(title)}</span><small>${esc(detail)}</small></div>`).join("")}</div>
      </div>
      ${context === "calendar" ? `<div class="routine-list" style="margin-top:10px">${routineMarkup(key, "calendar")}</div>` : ""}
    `;
  }

  function routineMarkup(key, context = "fitness") {
    const day = ensureDay(key);
    return routineData.map(([id, title, detail]) => `
      <label class="routine-row"><input class="check" type="checkbox" data-routine="${id}" data-routine-date="${key}" ${day.routines[id] ? "checked" : ""} /><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></label>
    `).join("");
  }

  function renderFitness() {
    const selectedDay = ensureDay(selectedFitnessDate);
    const week = weekKeys(fromKey(selectedFitnessDate));
    const completed = week.filter((key) => state.days[key]?.fitness).length;
    const routinesDone = Object.values(selectedDay.routines).filter(Boolean).length;
    document.getElementById("fitnessStats").innerHTML = [
      ["本周训练", `${completed} / 5`, "力量 3 次 · 有氧 2 次"],
      ["所选日期维护", `${routinesDone} / 5`, "早上 2 项 · 晚上 3 项"],
      ["当天训练", selectedDay.fitness ? "已完成" : "未完成", planFor(selectedFitnessDate).title]
    ].map(([label, value, note]) => `<article class="card metric"><span>${label}</span><strong>${value}</strong><span>${note}</span></article>`).join("");
    document.getElementById("fitnessDateTitle").textContent = dayText(selectedFitnessDate);
    document.getElementById("fitnessDateHint").textContent = selectedFitnessDate === todayKey() ? "今天" : planFor(selectedFitnessDate).title;
    document.getElementById("fitnessDayPlan").innerHTML = workoutMarkup(selectedFitnessDate, "fitness");
    document.getElementById("fitnessRoutines").innerHTML = routineMarkup(selectedFitnessDate);
    document.getElementById("supplementTrainingPanels").innerHTML = supplementaryTraining.map((panel) => `
      <article class="card training-panel">
        <div class="card-head"><div><h3>${esc(panel.title)}</h3><small>${esc(panel.note)}</small></div></div>
        <div class="training-row-list">${panel.rows.map(([action, frequency]) => `<div class="training-row"><strong>${esc(action)}</strong><span>${esc(frequency)}</span></div>`).join("")}</div>
      </article>
    `).join("");
  }

  function taskRows(key, context) {
    const day = ensureDay(key);
    if (!day.tasks.length) return '<div class="empty-state">当天还没有待办事项。</div>';
    return day.tasks.map((task) => `
      <div class="todo-row ${task.done ? "done" : ""}">
        <input class="check" type="checkbox" data-task-toggle="${task.id}" data-task-date="${key}" ${task.done ? "checked" : ""} aria-label="切换待办完成状态" />
        <input class="inline-input" data-task-text="${task.id}" data-task-date="${key}" value="${esc(task.text)}" aria-label="修改待办内容" />
        <button class="mini-btn danger" data-action="delete-task" data-id="${task.id}" data-task-date="${key}" aria-label="删除待办">×</button>
      </div>
    `).join("");
  }

  function renderReminders() {
    const stats = completionFor(selectedDate);
    document.getElementById("reminderDateTitle").textContent = dayText(selectedDate);
    document.getElementById("reminderProgress").textContent = `${stats.done} / ${stats.total} 项完成`;
    document.getElementById("reminderList").innerHTML = taskRows(selectedDate, "reminders");
    document.getElementById("notesDateLabel").textContent = dayText(selectedDate);
    document.getElementById("dayNotesInput").value = ensureDay(selectedDate).notes;
  }

  function renderMilestones() {
    const done = state.milestones.filter((item) => item.done).length;
    document.getElementById("masterTodoProgress").textContent = `${done} / ${state.milestones.length}`;
    document.getElementById("masterTodoList").innerHTML = state.milestones.length ? state.milestones.map((item) => `
      <div class="master-todo-row">
        <input class="check" type="checkbox" data-master-done="${item.id}" ${item.done ? "checked" : ""} aria-label="切换待办完成状态" />
        <div class="fields">
          <input class="inline-input" data-master-title="${item.id}" value="${esc(item.title)}" aria-label="修改待办内容" />
          <input class="inline-input" data-master-note="${item.id}" value="${esc(item.note || "")}" placeholder="补充说明" aria-label="修改补充说明" />
        </div>
        <button class="mini-btn danger" data-action="delete-master-todo" data-id="${item.id}" aria-label="删除待办">×</button>
      </div>
    `).join("") : '<div class="empty-state">清单为空，可以从下方添加。</div>';

    document.getElementById("eventList").innerHTML = state.events.length ? [...state.events].sort((a, b) => a.date.localeCompare(b.date)).map((event) => {
      const date = fromKey(event.date);
      return `<div class="event-row"><div class="event-date"><span><small>${date.getMonth() + 1}月</small>${date.getDate()}</span></div><div><strong>${esc(event.title)}</strong><p>${esc(event.copy || "")}</p></div><button class="mini-btn danger" data-action="delete-event" data-id="${event.id}" aria-label="删除重要日期">×</button></div>`;
    }).join("") : '<div class="empty-state">还没有重要日期。</div>';
  }

  function renderDayDashboard() {
    const day = ensureDay(selectedDate);
    const stats = completionFor(selectedDate);
    const weight = weightOn(selectedDate);
    const logs = projectLogsOn(selectedDate);
    const events = eventsOn(selectedDate);
    const dateHint = selectedDate === todayKey() ? "今天 · 修改会自动保存" : selectedDate < todayKey() ? "历史记录 · 可以补记" : "未来计划 · 可以提前安排";
    document.getElementById("calendarDaySummary").innerHTML = `
      <div class="summary-item"><small>心情</small><strong>${esc(day.mood || "未记录")}</strong></div>
      <div class="summary-item"><small>精力</small><strong>${esc(day.energy || "未记录")}</strong></div>
      <div class="summary-item"><small>饮水</small><strong>${Number(day.water) || 0} 杯</strong></div>
      <div class="summary-item"><small>体重</small><strong>${weight ? `${weight.weight} kg` : "未记录"}</strong></div>
    `;
    document.getElementById("calendarWorkoutPanel").innerHTML = `
      <div class="card-head"><div><h3>运动安排</h3><small>${esc(dayText(selectedDate))} · ${esc(planFor(selectedDate).title)}</small></div></div>
      ${workoutMarkup(selectedDate, "calendar")}
    `;
    document.getElementById("calendarWorkPanel").innerHTML = `
      <div class="card-head"><div><h3>事务工作</h3><small>${esc(dayText(selectedDate))} · ${esc(dateHint)}</small></div><span class="tag">${stats.rate}% 完成</span></div>
      <section class="day-section">
        <div class="subhead"><h4>待办事项</h4><span class="tag neutral">${stats.done} / ${stats.total}</span></div>
        <div class="todo-list">${taskRows(selectedDate, "calendar")}</div>
        <form class="form-row" id="calendarTaskForm" style="margin-top:10px"><label class="sr-only" for="calendarTaskInput">添加当天待办</label><input class="input" id="calendarTaskInput" maxlength="120" placeholder="添加当天待办" required /><button class="btn green" type="submit">添加</button></form>
      </section>
      <section class="day-section">
        <div class="subhead"><h4>项目推进记录</h4><span class="tag neutral">${logs.length} 条</span></div>
        ${logs.length ? logs.map((log) => `<div class="history-item"><time>${esc(log.project)}</time><span>${esc(log.text)}</span><span></span></div>`).join("") : '<div class="empty-state">当天没有项目推进记录。</div>'}
      </section>

      <section class="day-section">
        <div class="subhead"><h4>重要日期</h4><span class="tag neutral">${events.length} 项</span></div>
        ${events.length ? events.map((event) => `<div class="event-row"><div class="event-date"><span><small>当天</small>${fromKey(event.date).getDate()}</span></div><div><strong>${esc(event.title)}</strong><p>${esc(event.copy || "")}</p></div></div>`).join("") : '<div class="empty-state">当天没有重要日期。</div>'}
      </section>
    `;

    document.getElementById("calendarHealthPanel").innerHTML = `
      <div class="card-head"><div><h3>生活健康</h3><small>${esc(dayText(selectedDate))} · 状态、饮食与当天记录</small></div></div>
      <section class="day-section health-entry-section">
        <div class="subhead"><h4>状态与饮水</h4></div>
        <div class="form-grid">
          <label class="field"><span>心情</span><select class="select" data-day-health="mood"><option value="">尚未记录</option>${["很好", "平稳", "一般", "低落"].map((item) => `<option ${day.mood === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="field"><span>精力</span><select class="select" data-day-health="energy"><option value="">尚未记录</option>${["充足", "正常", "偏低", "疲惫"].map((item) => `<option ${day.energy === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="field"><span>饮食热量（可选）</span><input class="input" type="number" min="0" inputmode="numeric" data-day-health="calories" value="${esc(day.calories)}" placeholder="例如：1800" /></label>
          <label class="field"><span>体重（kg）</span><input class="input" id="calendarWeightInput" type="number" step="0.1" min="0" inputmode="decimal" value="${weight ? weight.weight : ""}" placeholder="尚未记录" /></label>
        </div>
        <div class="form-row" style="margin-top:10px"><span class="tag blue">饮水 ${Number(day.water) || 0} / 8 杯</span><button class="btn secondary" data-action="calendar-water-plus">＋ 一杯</button><button class="btn secondary" data-action="calendar-water-minus">减少</button><button class="btn green" data-action="save-calendar-health">保存状态</button></div>
      </section>

      <section class="day-section">
        <div class="form-grid health-notes-grid">
          <label class="field wide"><span>饮食简记</span><textarea class="textarea" id="calendarFoodInput" placeholder="记录主要食物和大致份量">${esc(day.food)}</textarea></label>
          <label class="field wide"><span>当天复盘</span><textarea class="textarea" id="calendarNotesInput" placeholder="记录推进情况和明天需要继续的事项">${esc(day.notes)}</textarea></label>
        </div>
        <button class="btn secondary" data-action="save-calendar-notes" style="margin-top:10px">保存当天记录</button>
      </section>
    `;
  }

  function renderCalendar() {
    renderCalendars();
    renderDayDashboard();
  }

  function renderAll() {
    renderHome();
    renderProjects();
    renderHealth();
    renderFitness();
    renderReminders();
    renderMilestones();
    renderCalendar();
  }

  function switchPage(page, updateHash = true) {
    const requested = page === "milestones" ? "reminders" : page;
    const valid = pageNames[requested] ? requested : "home";
    document.querySelectorAll("[data-screen]").forEach((screen) => screen.classList.toggle("active", screen.dataset.screen === valid));
    document.querySelectorAll("[data-page]").forEach((link) => {
      const active = link.dataset.page === valid;
      link.classList.toggle("active", active);
      if (link.matches("a")) {
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    });
    document.getElementById("pageCrumb").textContent = pageNames[valid];
    if (updateHash && location.hash !== `#${valid}`) history.pushState(null, "", `#${valid}`);
    if (valid === "calendar") renderCalendar();
    if (valid === "work") renderProjects();
    if (valid === "fitness") renderFitness();
    window.scrollTo(0, 0);
  }

  function updateSelectedDate(key) {
    selectedDate = key;
    const date = fromKey(key);
    monthCursor = new Date(date.getFullYear(), date.getMonth(), 1);
    renderHome();
    renderReminders();
    renderCalendar();
  }

  function setWeight(date, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const existing = state.weightHistory.find((entry) => entry.date === date);
    if (existing) existing.weight = numeric;
    else state.weightHistory.push({ date, weight: numeric });
    state.weightHistory = state.weightHistory.sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
    return true;
  }

  document.addEventListener("click", (event) => {
    const pageLink = event.target.closest("[data-page]");
    if (pageLink) {
      event.preventDefault();
      switchPage(pageLink.dataset.page);
      return;
    }

    const dateButton = event.target.closest("[data-date]");
    if (dateButton) {
      updateSelectedDate(dateButton.dataset.date);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id;

    if (action === "toggle-goal-edit") {
      editingGoals = !editingGoals;
      actionButton.textContent = editingGoals ? "完成" : "编辑";
      renderHome();
    }
    if (action === "add-goal") {
      const goal = { id: uid("goal"), title: "新年度目标", area: "未分类", progress: 0 };
      state.goals.push(goal);
      save();
      renderHome();
      requestAnimationFrame(() => {
        const input = document.querySelector(`[data-goal-title="${goal.id}"]`);
        input?.focus();
        input?.select();
      });
      return;
    }
    if (action === "delete-goal") {
      const goal = state.goals.find((item) => item.id === id);
      if (!goal || !window.confirm(`删除年度目标“${goal.title}”吗？`)) return;
      state.goals = state.goals.filter((item) => item.id !== id);
      save();
      renderHome();
      return;
    }
    if (action === "toggle-priority-edit") {
      editingPriorities = !editingPriorities;
      actionButton.textContent = editingPriorities ? "完成" : "编辑";
      renderHome();
    }
    if (action === "home-prev-month" || action === "prev-month") {
      monthCursor.setMonth(monthCursor.getMonth() - 1);
      renderCalendars();
    }
    if (action === "home-next-month" || action === "next-month") {
      monthCursor.setMonth(monthCursor.getMonth() + 1);
      renderCalendars();
    }
    if (action === "today") updateSelectedDate(todayKey());
    if (action === "fitness-prev-day") {
      selectedFitnessDate = addDays(selectedFitnessDate, -1);
      renderFitness();
    }
    if (action === "fitness-next-day") {
      selectedFitnessDate = addDays(selectedFitnessDate, 1);
      renderFitness();
    }
    if (action === "reminder-prev-day") {
      updateSelectedDate(addDays(selectedDate, -1));
    }
    if (action === "reminder-next-day") {
      updateSelectedDate(addDays(selectedDate, 1));
    }
    if (action === "toggle-workout") {
      const key = actionButton.dataset.workoutDate;
      const day = ensureDay(key);
      day.fitness = !day.fitness;
      save();
      renderFitness();
      renderCalendar();
      renderHome();
      notify(day.fitness ? "已记录训练完成" : "已取消训练完成");
    }
    if (action === "complete-home-task") {
      const task = ensureDay(todayKey()).tasks.find((item) => item.id === id);
      if (task) {
        task.done = true;
        save();
        renderHome();
        renderReminders();
        renderCalendar();
        notify("已完成一项待办");
      }
    }
    if (action === "delete-task") {
      if (!confirm("删除这条待办吗？")) return;
      const key = actionButton.dataset.taskDate;
      ensureDay(key).tasks = ensureDay(key).tasks.filter((task) => task.id !== id);
      save();
      renderHome();
      renderReminders();
      renderCalendar();
    }
    if (action === "add-project") {
      const title = prompt("项目名称");
      if (title?.trim()) {
        state.projects.unshift({ id: uid("project"), title: title.trim(), symbol: "•", area: "其他", status: "未开始", progress: 0, next: "", logs: [] });
        save();
        renderProjects();
        renderHome();
      }
    }
    if (action === "delete-project") {
      if (!confirm("删除这个项目及其历史记录吗？")) return;
      state.projects = state.projects.filter((project) => project.id !== id);
      save();
      renderProjects();
      renderHome();
    }
    if (action === "delete-project-log") {
      if (!confirm("删除这条推进记录吗？")) return;
      const project = state.projects.find((item) => item.id === actionButton.dataset.project);
      if (project) {
        project.logs = project.logs.filter((log) => log.id !== id);
        save();
        renderProjects();
        renderCalendar();
      }
    }
    if (action === "delete-master-todo") {
      if (!confirm("删除这条待办事项吗？")) return;
      state.milestones = state.milestones.filter((item) => item.id !== id);
      save();
      renderMilestones();
    }
    if (action === "toggle-event-form") {
      const form = document.getElementById("eventForm");
      form.hidden = !form.hidden;
      if (!form.hidden) {
        document.getElementById("eventDateInput").value = selectedDate;
        document.getElementById("eventTitleInput").focus();
      }
    }
    if (action === "delete-event") {
      if (!confirm("删除这个重要日期吗？")) return;
      state.events = state.events.filter((item) => item.id !== id);
      save();
      renderMilestones();
      renderCalendar();
      renderHome();
    }
    if (action === "water-plus" || action === "water-minus") {
      const day = ensureDay(todayKey());
      day.water = Math.max(0, Math.min(8, day.water + (action === "water-plus" ? 1 : -1)));
      save();
      renderHealth();
      renderCalendar();
      renderHome();
    }
    if (action === "calendar-water-plus" || action === "calendar-water-minus") {
      const day = ensureDay(selectedDate);
      day.water = Math.max(0, Math.min(8, day.water + (action === "calendar-water-plus" ? 1 : -1)));
      save();
      renderCalendar();
      renderHome();
    }
    if (action === "save-health") {
      const day = ensureDay(todayKey());
      day.mood = document.getElementById("moodInput").value;
      day.energy = document.getElementById("energyInput").value;
      day.calories = document.getElementById("calorieInput").value;
      save();
      renderCalendar();
      renderHome();
      notify("今日状态已保存");
    }
    if (action === "save-food") {
      ensureDay(todayKey()).food = document.getElementById("foodInput").value;
      save();
      renderCalendar();
      renderHome();
      notify("饮食记录已保存");
    }
    if (action === "save-day-notes") {
      ensureDay(selectedDate).notes = document.getElementById("dayNotesInput").value;
      save();
      renderHome();
      renderCalendar();
      notify("当天记录已保存");
    }
    if (action === "save-calendar-health") {
      const day = ensureDay(selectedDate);
      document.querySelectorAll("[data-day-health]").forEach((field) => {
        day[field.dataset.dayHealth] = field.value;
      });
      const weightInput = document.getElementById("calendarWeightInput");
      if (weightInput.value) setWeight(selectedDate, weightInput.value);
      save();
      renderHealth();
      renderCalendar();
      renderHome();
      notify("当天状态已保存");
    }
    if (action === "save-calendar-notes") {
      const day = ensureDay(selectedDate);
      day.food = document.getElementById("calendarFoodInput").value;
      day.notes = document.getElementById("calendarNotesInput").value;
      save();
      renderHome();
      renderReminders();
      renderCalendar();
      notify("当天记录已保存");
    }
    if (action === "export") {
      const blob = new Blob([JSON.stringify({ app: "kinetic-life-os", exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `life-workbench-backup-${todayKey()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("备份已导出");
    }
    if (action === "reset") {
      if (!confirm("确定清除当前设备的全部工作台记录吗？此操作无法撤销。")) return;
      localStorage.removeItem(STORE);
      localStorage.setItem(RESET_MARKER, "true");
      location.reload();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-task-toggle]")) {
      const task = ensureDay(target.dataset.taskDate).tasks.find((item) => item.id === target.dataset.taskToggle);
      if (task) task.done = target.checked;
      save();
      renderHome();
      renderReminders();
      renderCalendar();
    }
    if (target.matches("[data-routine]")) {
      ensureDay(target.dataset.routineDate).routines[target.dataset.routine] = target.checked;
      save();
      renderFitness();
      renderCalendar();
      renderHome();
    }
    if (target.matches("[data-master-done]")) {
      const item = state.milestones.find((todo) => todo.id === target.dataset.masterDone);
      if (item) item.done = target.checked;
      save();
      renderMilestones();
    }
    if (target.matches("[data-project-status]")) {
      const project = state.projects.find((item) => item.id === target.dataset.projectStatus);
      if (project && project.status !== target.value) {
        project.status = target.value;
        addProjectHistory(project, todayKey(), `状态更新为「${target.value}」`);
        save();
        renderProjects();
        renderHome();
        renderCalendar();
      }
    }
    if (target.matches("[data-project-progress]")) {
      const project = state.projects.find((item) => item.id === target.dataset.projectProgress);
      const progress = Number(target.value) || 0;
      if (project && Number(project.progress) !== progress) {
        project.progress = progress;
        addProjectHistory(project, todayKey(), `进度更新为 ${progress}%`);
        save();
        renderProjects();
        renderHome();
        renderCalendar();
      }
    }
    if (target.matches("[data-project-review]")) {
      const project = state.projects.find((item) => item.id === target.dataset.projectReview);
      if (project) project.reviewDate = target.value;
      save();
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-goal-title], [data-goal-progress], [data-goal-area]")) {
      const id = target.dataset.goalTitle || target.dataset.goalProgress || target.dataset.goalArea;
      const goal = state.goals.find((item) => item.id === id);
      if (goal) {
        if (target.dataset.goalTitle) goal.title = target.value;
        if (target.dataset.goalProgress) goal.progress = Math.max(0, Math.min(100, Number(target.value) || 0));
        if (target.dataset.goalArea) goal.area = target.value;
        save();
        const score = overallProgress();
        document.getElementById("overallProgress").textContent = `${score}%`;
        document.getElementById("overallRing").style.setProperty("--p", `${score}%`);
      }
    }
    if (target.matches("[data-priority-text], [data-priority-detail]")) {
      const id = target.dataset.priorityText || target.dataset.priorityDetail;
      const item = state.priorities.find((priority) => priority.id === id);
      if (item) {
        if (target.dataset.priorityText) item.text = target.value;
        if (target.dataset.priorityDetail) item.detail = target.value;
      }
      save();
    }
    if (target.matches("[data-task-text]")) {
      const task = ensureDay(target.dataset.taskDate).tasks.find((item) => item.id === target.dataset.taskText);
      if (task) task.text = target.value;
      save();
    }
    if (target.matches("[data-master-title], [data-master-note]")) {
      const id = target.dataset.masterTitle || target.dataset.masterNote;
      const item = state.milestones.find((todo) => todo.id === id);
      if (item) {
        if (target.dataset.masterTitle) item.title = target.value;
        if (target.dataset.masterNote) item.note = target.value;
      }
      save();
    }
    if (target.matches("[data-project-area], [data-project-next]")) {
      const id = target.dataset.projectArea || target.dataset.projectNext;
      const project = state.projects.find((item) => item.id === id);
      if (project) {
        if (target.dataset.projectArea) project.area = target.value;
        if (target.dataset.projectNext) project.next = target.value;
      }
      save();
    }
  });

  document.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "reminderForm") {
      const input = document.getElementById("reminderInput");
      if (input.value.trim()) ensureDay(selectedDate).tasks.push({ id: uid("task"), text: input.value.trim(), done: false, area: "生活" });
      input.value = "";
      save();
      renderHome();
      renderReminders();
      renderCalendar();
      notify("已添加待办");
    }
    if (form.id === "calendarTaskForm") {
      const input = document.getElementById("calendarTaskInput");
      if (input.value.trim()) ensureDay(selectedDate).tasks.push({ id: uid("task"), text: input.value.trim(), done: false, area: "生活" });
      save();
      renderHome();
      renderReminders();
      renderCalendar();
      notify("已添加当天待办");
    }
    if (form.matches("[data-project-log]")) {
      const project = state.projects.find((item) => item.id === form.dataset.projectLog);
      const date = form.querySelector("[data-log-date]").value || todayKey();
      const input = form.querySelector('input:not([type="date"])');
      if (project && input.value.trim()) {
        addProjectHistory(project, date, input.value.trim());
        input.value = "";
        save();
        renderProjects();
        renderHome();
        renderCalendar();
        notify("项目记录已保存");
      }
    }
    if (form.id === "weightForm") {
      const input = document.getElementById("weightInput");
      if (setWeight(todayKey(), input.value)) {
        input.value = "";
        save();
        renderHealth();
        renderCalendar();
        notify("今日体重已记录");
      }
    }
    if (form.id === "masterTodoForm") {
      const title = document.getElementById("masterTodoTitle");
      const note = document.getElementById("masterTodoNote");
      if (title.value.trim()) state.milestones.push({ id: uid("todo"), title: title.value.trim(), note: note.value.trim(), done: false });
      form.reset();
      save();
      renderMilestones();
      notify("已添加待办事项");
    }
    if (form.id === "eventForm") {
      const date = document.getElementById("eventDateInput").value;
      const title = document.getElementById("eventTitleInput").value.trim();
      const copy = document.getElementById("eventCopyInput").value.trim();
      if (date && title) state.events.push({ id: uid("event"), date, title, copy });
      form.reset();
      form.hidden = true;
      save();
      renderMilestones();
      renderCalendar();
      renderHome();
      notify("重要日期已保存");
    }
  });

  document.getElementById("globalSearch").addEventListener("input", () => {
    if (location.hash !== "#work") switchPage("work");
    renderProjects();
  });

  document.getElementById("importInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2e6) {
      alert("备份文件过大，无法导入。");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed.data || parsed;
      if (!data || typeof data !== "object" || !Array.isArray(data.projects) || !Array.isArray(data.goals) || !data.days) throw new Error("bad");
      if (!confirm("导入会替换当前设备的工作台记录，是否继续？")) return;
      localStorage.setItem(STORE, JSON.stringify(data));
      state = loadState();
      save();
      renderAll();
      notify("备份已恢复");
    } catch {
      alert("无法识别这个备份文件，请选择由本工作台导出的 JSON 文件。");
    }
  });

  window.addEventListener("popstate", () => switchPage(location.hash.slice(1), false));
  save();
  renderAll();
  switchPage(location.hash.slice(1) || "home", false);
})();
