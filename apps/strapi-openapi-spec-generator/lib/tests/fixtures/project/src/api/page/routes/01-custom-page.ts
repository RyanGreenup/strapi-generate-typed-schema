const dynamicPath = "/pages/dynamic";

export default {
  routes: [
    {
      method: "GET",
      path: "/pages/:id/preview",
      handler: "api::page.page.findOne",
      config: { auth: false },
    },
    {
      method: "GET",
      path: "/pages/by-slug/:slug",
      handler: "page.findBySlug",
    },
    {
      method: "GET",
      path: dynamicPath,
      handler: "page.dynamic",
    },
  ],
};
