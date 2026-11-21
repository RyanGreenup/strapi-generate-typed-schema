import type { Schema, Struct } from "@strapi/strapi";

export interface ApiArticleArticle extends Struct.CollectionTypeSchema {
  collectionName: "articles";
  info: {
    displayName: "Article";
    singularName: "article";
    pluralName: "articles";
  };
  options: { draftAndPublish: true };
  attributes: {
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 5; maxLength: 10 }>;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 6; maxLength: 40 }>;
    rating: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<{ min: 2; max: 8 }>;
    price: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<{ min: 0.5; max: 10.5 }>;
    seo: Schema.Attribute.Component<"shared.seo", true> &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<{ min: 1; max: 2 }>;
    page: Schema.Attribute.Relation<"manyToOne", "api::page.page"> &
      Schema.Attribute.Required;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<"default">;
    slug: Schema.Attribute.UID &
      Schema.Attribute.SetMinMaxLength<{ minLength: 3; maxLength: 12 }>;
    shortText: Schema.Attribute.String;
    summary: Schema.Attribute.Component<"shared.seo", false>;
    link: Schema.Attribute.Component<"shared.conditional-link", false>;
    blocks: Schema.Attribute.DynamicZone<
      ["shared.seo", "shared.conditional-link"]
    > &
      Schema.Attribute.SetMinMax<{ min: 1; max: 2 }>;
    cover: Schema.Attribute.Media<"images", false> & Schema.Attribute.Required;
    internalCode: Schema.Attribute.String &
      Schema.Attribute.Required & { writable: false };
    createdAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    publishedAt: Schema.Attribute.DateTime;
  };
}

export interface ApiPagePage extends Struct.CollectionTypeSchema {
  collectionName: "pages";
  info: {
    displayName: "Page";
    singularName: "page";
    pluralName: "pages";
  };
  options: { draftAndPublish: false };
  attributes: {
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 5; maxLength: 10 }>;
    passcode: Schema.Attribute.Password;
    secret: Schema.Attribute.String & Schema.Attribute.Private;
    editorNote: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    publishedAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String;
    // Added during registration; not present in the page's schema.json.
    plugin$date: Schema.Attribute.DateTime;
    pluginJson: Schema.Attribute.JSON;
    pluginPassword: Schema.Attribute.Password;
    pluginPrivate: Schema.Attribute.String & Schema.Attribute.Private;
    pluginComponent: Schema.Attribute.Component<"shared.seo", false>;
  };
}

export interface ApiSiteSettingSiteSetting extends Struct.SingleTypeSchema {
  collectionName: "site_settings";
  info: {
    displayName: "Site setting";
    singularName: "site-setting";
    pluralName: "site-settings";
  };
  options: { draftAndPublish: false };
  attributes: { siteName: Schema.Attribute.String };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: "files";
  info: {
    displayName: "File";
    singularName: "file";
    pluralName: "files";
  };
  options: { draftAndPublish: false };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
    alternativeText: Schema.Attribute.String;
    caption: Schema.Attribute.String;
    width: Schema.Attribute.Integer;
    height: Schema.Attribute.Integer;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    ext: Schema.Attribute.String;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.String;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: "components_shared_seo";
  info: { displayName: "SEO" };
  attributes: {
    heading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 3; maxLength: 8 }>;
  };
}

export interface SharedConditionalLink extends Struct.ComponentSchema {
  collectionName: "components_shared_conditional_links";
  info: { displayName: "Conditional link" };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    weight: Schema.Attribute.Float & Schema.Attribute.DefaultTo<0>;
    attachment: Schema.Attribute.Media<"images" | "files", false>;
    kind: Schema.Attribute.Enumeration<["internal", "external"]> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<"internal">;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 1 }>;
    url: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{ minLength: 1 }>;
  };
}

declare module "@strapi/strapi" {
  export module Public {
    export interface ContentTypeSchemas {
      "api::article.article": ApiArticleArticle;
      "api::page.page": ApiPagePage;
      "api::site-setting.site-setting": ApiSiteSettingSiteSetting;
      "plugin::upload.file": PluginUploadFile;
    }
    export interface ComponentSchemas {
      "shared.seo": SharedSeo;
      "shared.conditional-link": SharedConditionalLink;
    }
  }
}
