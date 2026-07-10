import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/current";
import { listAccessibleSpaces } from "@/lib/spaces/queries";
import { Badge } from "@/components/ui/badge";

export default async function HomePage() {
  const { user } = await requireSession("/");
  const t = await getTranslations("home");
  const spaces = await listAccessibleSpaces(user);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-h1 text-fg">{t("greeting", { name: user.name })}</h1>
        <p className="mt-1 text-body-ui text-fg-secondary">{t("subtitle")}</p>
      </header>

      <section>
        <h2 className="mb-3 text-h3 text-fg">{t("mySpaces")}</h2>
        {spaces.length === 0 ? (
          <p className="text-body-ui text-fg-tertiary">{t("noSpaces")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  href={`/s/${s.slug}`}
                  className="flex flex-col gap-1 rounded-md border border-edge bg-raised p-4 transition-shadow hover:shadow-sm"
                >
                  <span className="text-h4 text-fg">
                    {s.icon ? `${s.icon} ` : ""}
                    {s.name}
                  </span>
                  <Badge variant={s.visibility === "private" ? "neutral" : "primary"}>
                    {t(`visibility.${s.visibility}`)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
