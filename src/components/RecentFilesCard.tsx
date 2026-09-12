import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileImage, FileText, Files } from "lucide-react";
import { getOperatingSystemSnapshot } from "@/lib/os.functions";

type Attachment = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  url: string | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RecentFilesCard() {
  const load = useServerFn(getOperatingSystemSnapshot);
  const [files, setFiles] = useState<Attachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await load({});
        if (!cancelled) setFiles((result.attachments ?? []) as Attachment[]);
      } catch (error) {
        console.error("Recent files failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <section className="emery-glass overflow-hidden rounded-3xl">
      <div className="border-b border-border/50 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Files className="size-4 text-primary" />
          <p className="text-sm font-semibold">Recent Emery files</p>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Files and photos you gave Emery stay attached to the conversation that created the context.
        </p>
      </div>
      {files.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">No recent attachments yet.</p>
      ) : (
        <div className="divide-y divide-border/45">
          {files.slice(0, 6).map((file) => {
            const Icon = file.mime_type.startsWith("image/") ? FileImage : FileText;
            const row = (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className="size-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.file_name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatBytes(file.size_bytes)} · {new Date(file.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            );
            return file.url ? (
              <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="emery-press block">
                {row}
              </a>
            ) : (
              <div key={file.id}>{row}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}
