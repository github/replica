import type { PageProps } from "./types"
import styles from "./styles.module.css"

export function __SCAFFOLD_PASCAL__Page({ data }: PageProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>{data.title}</h1>
        <p>{data.description}</p>
      </header>
      <section aria-labelledby="__SCAFFOLD_SLUG__-items">
        <h2 id="__SCAFFOLD_SLUG__-items">Seeded items</h2>
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
