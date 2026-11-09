import { useState } from "react"

import styles from "./styles.module.css"
import type { HomePageProps } from "./types"

const students = [
  { id: "BT-1042", name: "سارة العتيبي", evidence: "4 من 4", status: "مكتمل", missing: "—" },
  {
    id: "BT-1048",
    name: "عمر الحربي",
    evidence: "3 من 4",
    status: "أدلة ناقصة",
    missing: "تحليل أصحاب المصلحة",
  },
  {
    id: "BT-1051",
    name: "نورة القحطاني",
    evidence: "3 من 4",
    status: "أدلة ناقصة",
    missing: "ملخص العوامل الخارجية",
  },
  {
    id: "BT-1057",
    name: "خالد الشهري",
    evidence: "2 من 4",
    status: "أدلة ناقصة",
    missing: "تقرير النشاط الثاني",
  },
  {
    id: "BT-1063",
    name: "ريم الغامدي",
    evidence: "3 من 4",
    status: "أدلة ناقصة",
    missing: "تقرير النشاط الأول",
  },
]

const criteria = [
  { code: "P1", text: "وصف خصائص منشأتين مختلفتين", status: "مكتمل" },
  { code: "P2", text: "شرح أثر العوامل الخارجية على المنشأة", status: "قيد التقييم" },
  { code: "M1", text: "تحليل العلاقة بين أهداف المنشأة وقراراتها", status: "قيد التقييم" },
  { code: "D1", text: "تقييم مدى نجاح الاستجابة للتغيرات", status: "لم يبدأ" },
]

const activities = [
  {
    number: "01",
    name: "ملف تعريف المنشآت",
    detail: "يرتبط بمعياري P1 وP2",
    progress: "18 من 24 طالبًا",
  },
  {
    number: "02",
    name: "تحليل بيئة الأعمال",
    detail: "يرتبط بمعياري P2 وM1",
    progress: "12 من 24 طالبًا",
  },
  {
    number: "03",
    name: "تقرير التقييم النهائي",
    detail: "يرتبط بمعيار D1",
    progress: "6 من 24 طالبًا",
  },
]

const centerRequirements = [
  { name: "غلاف التقرير باسم الطالب ورقمه", progress: "21 من 24" },
  { name: "تأمل شخصي بعد كل نشاط", progress: "16 من 24" },
]

const navigation = [
  { label: "نظرة عامة", href: "#overview", icon: "◫" },
  { label: "الأنشطة", href: "#activities", icon: "▤" },
  { label: "معايير بيرسون", href: "#criteria", icon: "✓" },
  { label: "الطلبة", href: "#students", icon: "♧" },
  { label: "الأدلة", href: "#evidence", icon: "⌕" },
]

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "مكتمل" ? styles.complete : status === "أدلة ناقصة" ? styles.missing : styles.review

  return <span className={`${styles.status} ${tone}`}>{status}</span>
}

export function HomePage({ aboutLink }: HomePageProps) {
  const [query, setQuery] = useState("")
  const [activeSection, setActiveSection] = useState("#overview")
  const visibleStudents = students.filter((student) =>
    `${student.name} ${student.id}`.includes(query.trim()),
  )

  return (
    <div className={styles.app} dir="rtl">
      <aside className={styles.sidebar}>
        <a
          className={styles.brand}
          href="#overview"
          aria-label="مرصد، الصفحة الرئيسية"
          onClick={() => setActiveSection("#overview")}
        >
          <span className={styles.brandMark} aria-hidden="true">
            م
          </span>
          <span>
            <strong>مِرصد</strong>
            <small>متابعة التقييم المهني</small>
          </span>
        </a>

        <div className={styles.courseLabel}>مساحة التقييم</div>
        <nav className={styles.navigation} aria-label="التنقل الرئيسي">
          {navigation.map((item) => (
            <a
              className={`${styles.navLink} ${item.href === activeSection ? styles.active : ""}`}
              href={item.href}
              key={item.href}
              aria-current={item.href === activeSection ? "page" : undefined}
              onClick={() => setActiveSection(item.href)}
            >
              <span className={styles.navIcon} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.href === "#evidence" && <span className={styles.navCount}>5</span>}
            </a>
          ))}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.helpCard}>
            <span className={styles.helpDot} />
            <span>
              <strong>الفصل الأول</strong>
              <small>العام التدريبي 2025–2026</small>
            </span>
          </div>
          <div className={styles.profile}>
            <span className={styles.avatar}>لل</span>
            <span>
              <strong>ليان السالم</strong>
              <small>مدرّسة المادة</small>
            </span>
            <span className={styles.profileMenu} aria-hidden="true">
              ⋯
            </span>
          </div>
          <div className={styles.aboutLink}>{aboutLink}</div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>البرامج</span>
            <span aria-hidden="true">/</span>
            <strong>إدارة الأعمال</strong>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.termPill}>
              <span className={styles.liveDot} />
              الفصل الأول · 2025–2026
            </span>
            <button className={styles.notificationButton} type="button" aria-label="الإشعارات">
              ♧<span className={styles.notificationDot} />
            </button>
          </div>
        </header>

        <div className={styles.content}>
          <section className={styles.pageHeading} id="overview">
            <div>
              <p className={styles.eyebrow}>
                مركز نبراس للتدريب المهني <span>·</span> الفوج 04
              </p>
              <h1>لوحة التقييم</h1>
              <p className={styles.subtitle}>تابعي تقدّم الطلبة والأدلة لكل نشاط ومعيار.</p>
            </div>
            <div className={styles.unitCard}>
              <span className={styles.unitIcon} aria-hidden="true">
                ب
              </span>
              <span>
                <small>المؤهل والوحدة</small>
                <strong>BTEC · استكشاف الأعمال</strong>
              </span>
            </div>
          </section>

          <section className={styles.metrics} aria-label="ملخص التقييم">
            <article className={styles.metricCard}>
              <div className={styles.metricTop}>
                <span>إجمالي الطلبة</span>
                <span className={`${styles.metricIcon} ${styles.purpleIcon}`} aria-hidden="true">
                  ♧
                </span>
              </div>
              <strong className={styles.metricValue}>24</strong>
              <span className={styles.metricNote}>في هذا الفوج</span>
            </article>
            <article className={styles.metricCard}>
              <div className={styles.metricTop}>
                <span>أكملوا التقييم</span>
                <span className={`${styles.metricIcon} ${styles.greenIcon}`} aria-hidden="true">
                  ✓
                </span>
              </div>
              <strong className={styles.metricValue}>17</strong>
              <span className={styles.metricNote}>
                <span className={styles.positive}>↑ 3</span> هذا الأسبوع
              </span>
            </article>
            <article className={styles.metricCard}>
              <div className={styles.metricTop}>
                <span>أدلة تحتاج متابعة</span>
                <span className={`${styles.metricIcon} ${styles.amberIcon}`} aria-hidden="true">
                  !
                </span>
              </div>
              <strong className={styles.metricValue}>5</strong>
              <span className={styles.metricNote}>لدى 4 طلبة</span>
            </article>
            <article className={`${styles.metricCard} ${styles.progressCard}`}>
              <div className={styles.metricTop}>
                <span>إنجاز المجموعة</span>
                <span className={`${styles.metricIcon} ${styles.blueIcon}`} aria-hidden="true">
                  ◷
                </span>
              </div>
              <strong className={styles.metricValue}>71%</strong>
              <div className={styles.progressTrack} aria-label="إنجاز المجموعة 71%">
                <span style={{ width: "71%" }} />
              </div>
              <span className={styles.metricNote}>17 من 24 طالبًا</span>
            </article>
          </section>

          <div className={styles.dashboardGrid}>
            <section className={`${styles.panel} ${styles.criteriaPanel}`} id="criteria">
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitleLine}>
                    <h2>معايير التقييم</h2>
                    <span className={styles.officialTag}>متطلبات بيرسون</span>
                  </div>
                  <p>المعايير الرسمية للوحدة · 4 معايير</p>
                </div>
                <a className={styles.textLink} href="#activities">
                  عرض الأنشطة <span aria-hidden="true">←</span>
                </a>
              </div>
              <div className={styles.criteriaList}>
                {criteria.map((criterion) => (
                  <div className={styles.criterion} key={criterion.code}>
                    <span className={styles.criterionCode}>{criterion.code}</span>
                    <span className={styles.criterionText}>{criterion.text}</span>
                    <StatusBadge status={criterion.status} />
                  </div>
                ))}
              </div>
              <p className={styles.disclaimer}>
                أمثلة توضيحية لبيانات تجريبية؛ يُرجى الرجوع إلى مواصفة الوحدة المعتمدة.
              </p>
            </section>

            <section className={`${styles.panel} ${styles.activitiesPanel}`} id="activities">
              <div className={styles.sectionHeader}>
                <div>
                  <h2>الأنشطة</h2>
                  <p>أنشطة الوحدة وتسليمات الطلبة</p>
                </div>
                <span className={styles.countPill}>3 أنشطة</span>
              </div>
              <div className={styles.activityList}>
                {activities.map((activity) => (
                  <article className={styles.activity} key={activity.number}>
                    <span className={styles.activityNumber}>{activity.number}</span>
                    <div className={styles.activityInfo}>
                      <strong>{activity.name}</strong>
                      <small>{activity.detail}</small>
                    </div>
                    <span className={styles.activityProgress}>{activity.progress}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className={`${styles.panel} ${styles.studentsPanel}`} id="students">
              <div className={styles.sectionHeader}>
                <div>
                  <h2>متابعة الطلبة</h2>
                  <p>حالة التقييم والأدلة المقدّمة</p>
                </div>
                <label className={styles.searchBox}>
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="ابحثي عن طالب"
                    aria-label="ابحثي عن طالب بالاسم أو الرقم"
                  />
                </label>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">الطالب</th>
                      <th scope="col">الأدلة المقدّمة</th>
                      <th scope="col">الأدلة الناقصة</th>
                      <th scope="col">حالة التقييم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <span className={styles.studentName}>{student.name}</span>
                          <span className={styles.studentId}>{student.id}</span>
                        </td>
                        <td className={styles.evidenceCount}>{student.evidence}</td>
                        <td
                          className={
                            student.missing === "—" ? styles.noMissing : styles.missingText
                          }
                        >
                          {student.missing}
                        </td>
                        <td>
                          <StatusBadge status={student.status} />
                        </td>
                      </tr>
                    ))}
                    {visibleStudents.length === 0 && (
                      <tr>
                        <td className={styles.emptyState} colSpan={4}>
                          لا يوجد طالب بهذا الاسم أو الرقم.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`${styles.panel} ${styles.evidencePanel}`} id="evidence">
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitleLine}>
                    <h2>متطلبات المركز</h2>
                    <span className={styles.centerTag}>إضافية</span>
                  </div>
                  <p>متطلبات تنظيمية داخلية، وليست معايير بيرسون</p>
                </div>
              </div>
              <div className={styles.centerRequirements}>
                {centerRequirements.map((requirement) => (
                  <div className={styles.centerRequirement} key={requirement.name}>
                    <span className={styles.requirementCheck} aria-hidden="true">
                      ✓
                    </span>
                    <span>{requirement.name}</span>
                    <small>{requirement.progress}</small>
                  </div>
                ))}
              </div>
              <div className={styles.missingCallout}>
                <span className={styles.calloutIcon} aria-hidden="true">
                  !
                </span>
                <span>
                  <strong>5 أدلة ناقصة</strong>
                  <small>راجعي الطلبة الذين يحتاجون إلى استكمال الأدلة.</small>
                </span>
                <a href="#students" aria-label="الانتقال إلى قائمة الطلبة">
                  ←
                </a>
              </div>
            </section>
          </div>
          <footer className={styles.footer}>
            <span>بيانات توضيحية خيالية لأغراض العرض فقط.</span>
            <span>
              مِرصد <span aria-hidden="true">·</span> مساحة تعليمية تجريبية
            </span>
          </footer>
        </div>
      </main>
    </div>
  )
}
