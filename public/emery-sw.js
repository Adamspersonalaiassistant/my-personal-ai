self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "You have a reminder from Emery." };
  }

  const title = data.title || "Emery";
  const options = {
    body: data.body || "You have a reminder from Emery.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.notificationId ? `emery-${data.notificationId}` : "emery-reminder",
    renotify: false,
    data: {
      url: data.url || "/calendar",
      notificationId: data.notificationId || null,
      sourceType: data.sourceType || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/calendar";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
