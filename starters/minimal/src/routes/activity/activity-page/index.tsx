import type { PageProps } from "./types"
import styles from "./styles.module.css"

export function ActivityPage({ data }: PageProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>{data.title}</h1>
        <p>{data.description}</p>
      </header>
      <section aria-labelledby="activity-items">
        <h2 id="activity-items">Seeded items</h2>
        <p>{data.itemCount} total</p>
        <ul>
          {data.items.map((item) => (
            <li key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
