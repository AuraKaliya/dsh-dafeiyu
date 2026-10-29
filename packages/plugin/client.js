// Built from module-owned management UI. React is supplied by DSH.
window.__ModuleLoader__.load({id:'dsh-dafeiyu',factory(require){const module={exports:{}};const exports=module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/plugin/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// packages/core/client/management.js
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;
function TaskPanel({ call, perform, ui: { Button: Button2, Detail: Detail2 } }) {
  const [rows, setRows] = import_react.default.useState(null), [offset, setOffset] = import_react.default.useState(0), [detail, setDetail] = import_react.default.useState(null);
  const load = async () => setRows(await call("list", { offset }));
  return h("div", null, h(Button2, { onClick: () => perform(load) }, "\u8BFB\u53D6\u4EFB\u52A1\u5217\u8868"), ...(rows ?? []).map((row) => h("article", { key: row.id, className: "df-record" }, h("strong", null, row.id), h("p", null, `${row.state} \xB7 ${row.updatedAt}`), h(Button2, { onClick: () => perform(async () => setDetail(await call("detail", { id: row.id }))) }, "\u67E5\u770B\u8BE6\u60C5"))), rows?.length === 0 && h("p", null, "\u5F53\u524D\u6CA1\u6709\u4EFB\u52A1\u8BB0\u5F55\u3002"), h("div", { className: "df-actions" }, h(Button2, { disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 50)) }, "\u4E0A\u4E00\u9875"), h("span", null, `\u8D77\u59CB\u8BB0\u5F55 ${offset + 1}\uFF0C\u70B9\u51FB\u8BFB\u53D6\u5237\u65B0`), h(Button2, { disabled: (rows?.length ?? 0) < 50, onClick: () => setOffset(offset + 50) }, "\u4E0B\u4E00\u9875")), detail && h("div", { className: "df-editor" }, h("h3", null, "\u4EFB\u52A1\u8BE6\u60C5"), ...[["\u6982\u51B5", detail.run], ["\u6267\u884C\u8BB0\u5F55\u4E0E\u56DE\u6267", detail.operations], ["\u4EFB\u52A1\u7ED3\u679C", detail.result ?? "\u6CA1\u6709\u5F53\u524D\u53EF\u8BFB\u53D6\u7684\u5DF2\u6838\u9A8C\u7ED3\u679C"], ["\u81EA\u4E3B\u53CD\u601D", detail.experience ?? "\u6CA1\u6709\u5BF9\u5E94\u7684\u660E\u786E\u53CD\u601D\u8BB0\u5F55"], ["\u7528\u91CF\u8BB0\u5F55", detail.usage ?? "\u7528\u91CF\u5F85\u6838\u5B9E"], ["\u4E0A\u4E0B\u6587\u4E0E\u68C0\u67E5\u70B9", detail.status]].map(([title, value]) => h(Detail2, { key: title, title, value })), h("div", { className: "df-actions" }, ...(detail.allowedActions ?? []).map((action) => h(Button2, { key: action, onClick: () => perform(async () => {
    await call(action, { id: detail.run.id, expectedVersion: detail.run.version, requestId: crypto.randomUUID() });
    setDetail(await call("detail", { id: detail.run.id }));
    await load();
  }) }, { pause: "\u8BF7\u6C42\u6682\u505C", cancel: "\u8BF7\u6C42\u53D6\u6D88", resume: "\u4ECE\u68C0\u67E5\u70B9\u7EE7\u7EED" }[action]))), h(Button2, { onClick: () => setDetail(null) }, "\u6536\u8D77\u8BE6\u60C5")));
}
var managementPanels = [{ id: "tasks", component: TaskPanel }];

// packages/memory/client/management.js
var import_react2 = __toESM(require("react"), 1);
var h2 = import_react2.default.createElement;
function MemoryPanel({ call, perform, ui: { Button: Button2, Detail: Detail2 } }) {
  const [rows, setRows] = import_react2.default.useState(null), [query, setQuery] = import_react2.default.useState(""), [offset, setOffset] = import_react2.default.useState(0), [persona, setPersona] = import_react2.default.useState(null);
  const load = async () => setRows(await call("list", { query, offset }));
  return h2("div", null, h2("div", { className: "df-actions" }, h2(Button2, { onClick: () => perform(async () => setPersona(await call("status", null))) }, "\u67E5\u770B\u5F53\u524D\u4EBA\u683C\u4E0E\u53CD\u601D"), h2("input", { value: query, "aria-label": "\u641C\u7D22\u8BB0\u5FC6", placeholder: "\u641C\u7D22\u8BB0\u5FC6\u5185\u5BB9", onChange: (e) => {
    setQuery(e.target.value);
    setOffset(0);
  } }), h2(Button2, { onClick: () => perform(load) }, "\u8BFB\u53D6\u8BB0\u5FC6")), persona && h2("section", { className: "df-editor" }, h2(Detail2, { title: "\u521D\u59CB\u5316\u8EAB\u4EFD\u5E95\u8272\uFF08\u53EA\u8BFB\uFF09", value: persona.foundation?.text ?? "\u5C1A\u672A\u5BFC\u5165" }), h2(Detail2, { title: "\u5F53\u524D\u81EA\u6211\u8BA4\u8BC6\uFF08\u53EA\u8BFB\uFF09", value: persona.self }), h2("h3", null, "\u660E\u786E\u4FDD\u5B58\u7684\u53CD\u601D\u4F9D\u636E"), ...(persona.reflections ?? []).map((item) => h2("article", { key: item.id, className: "df-record" }, h2("p", null, item.thought), h2("p", { className: "df-muted" }, `${item.at} \xB7 ${item.deleted ? "\u5DF2\u5220\u9664" : "\u5F53\u524D\u53EF\u7528"}`), h2(Detail2, { title: "\u5B8C\u6574\u4F9D\u636E\u4E0E\u4E0D\u786E\u5B9A\u6027", value: item }), h2(Button2, { onClick: () => perform(async () => {
    await call("reflection", { id: item.id, expectedVersion: item.stateVersion, deleted: !item.deleted, requestId: crypto.randomUUID(), reason: "\u4E3B\u4EBA\u7BA1\u7406\u4EBA\u683C\u8BB0\u5FC6\u4F9D\u636E" });
    setPersona(await call("status", null));
  }) }, item.deleted ? "\u6062\u590D\u4F9D\u636E" : "\u5220\u9664\u4F9D\u636E")))), ...(rows ?? []).map((item) => h2("article", { key: item.id, className: "df-record" }, h2("strong", null, item.content.title ?? item.id), h2("p", { className: "df-muted" }, `${item.deleted ? "\u5DF2\u5220\u9664" : "\u5F53\u524D\u8BB0\u5F55"} \xB7 ${item.route}`), h2(Detail2, { title: "\u8BB0\u5FC6\u5185\u5BB9\u4E0E\u6765\u6E90", value: item.content }), h2(Button2, { onClick: () => perform(async () => {
    await call(item.deleted ? "restore" : "delete", { id: item.id, expectedVersion: item.version, requestId: crypto.randomUUID(), reason: "\u4E3B\u4EBA\u901A\u8FC7\u7BA1\u7406\u4E2D\u5FC3\u7BA1\u7406\u8BB0\u5FC6\u4F9D\u636E" });
    await load();
  }) }, item.deleted ? "\u6062\u590D\u8BB0\u5FC6" : "\u5220\u9664\u8BB0\u5FC6"))), rows?.length === 0 && h2("p", null, "\u6CA1\u6709\u5339\u914D\u7684\u8BB0\u5FC6\u3002"), h2("div", { className: "df-actions" }, h2(Button2, { disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 50)) }, "\u4E0A\u4E00\u9875"), h2("span", null, `\u8D77\u59CB\u8BB0\u5F55 ${offset + 1}\uFF0C\u70B9\u51FB\u8BFB\u53D6\u5237\u65B0`), h2(Button2, { disabled: (rows?.length ?? 0) < 50, onClick: () => setOffset(offset + 50) }, "\u4E0B\u4E00\u9875")));
}
var managementPanels2 = [{ id: "memory", component: MemoryPanel }];

// packages/channel-qq/client/management.js
var import_react3 = __toESM(require("react"), 1);
var h3 = import_react3.default.createElement;
function StickerPanel({ call, perform, ui: { Button: Button2, Detail: Detail2 } }) {
  const [rows, setRows] = import_react3.default.useState(null), [query, setQuery] = import_react3.default.useState(""), [offset, setOffset] = import_react3.default.useState(0), [image, setImage] = import_react3.default.useState(null), [edit, setEdit] = import_react3.default.useState(null);
  const load = async () => setRows(await call("stickers.list", { query, offset }));
  const update = (item, patch) => perform(async () => {
    await call("stickers.update", { id: item.id, expectedVersion: item.version, ...patch });
    await load();
  });
  return h3("div", null, h3("div", { className: "df-actions" }, h3("input", { value: query, "aria-label": "\u641C\u7D22\u8868\u60C5\u7D20\u6750", placeholder: "\u540D\u79F0\u3001\u8BF4\u660E\u3001\u6807\u7B7E", onChange: (e) => {
    setQuery(e.target.value);
    setOffset(0);
  } }), h3(Button2, { onClick: () => perform(load) }, "\u8BFB\u53D6\u8868\u60C5\u7D20\u6750")), ...(rows ?? []).map((item) => h3("article", { key: item.id, className: "df-record" }, h3("strong", null, item.name), h3("p", null, item.description), h3("p", { className: "df-muted" }, `${item.deleted ? "\u5DF2\u5220\u9664" : item.enabled ? "\u542F\u7528\u4E2D" : "\u5DF2\u505C\u7528"} \xB7 ${item.scope === "global" ? "\u5168\u5C40\u7D20\u6750" : "\u9650\u5B9A\u4F1A\u8BDD"} \xB7 \u4F7F\u7528 ${item.uses} \u6B21`), h3(Detail2, { title: "\u6807\u7B7E\u3001\u6765\u6E90\u4E0E\u4F7F\u7528\u8BB0\u5F55", value: { tags: item.tags, scene: item.scene, origin: item.origin, collectedAt: item.collectedAt, lastUsedAt: item.lastUsedAt } }), h3("div", { className: "df-actions" }, h3(Button2, { onClick: () => perform(async () => setImage(await call("stickers.preview", { id: item.id }))) }, "\u9884\u89C8"), h3(Button2, { onClick: () => setEdit({ ...item, tags: item.tags.join(", ") }) }, "\u7F16\u8F91\u8D44\u6599"), h3(Button2, { disabled: item.deleted, onClick: () => update(item, { enabled: !item.enabled }) }, item.enabled ? "\u505C\u7528" : "\u542F\u7528"), h3(Button2, { onClick: () => update(item, { deleted: !item.deleted }) }, item.deleted ? "\u6062\u590D" : "\u5220\u9664")))), rows?.length === 0 && h3("p", null, "\u6CA1\u6709\u5339\u914D\u7684\u8868\u60C5\u7D20\u6750\u3002"), image && h3("figure", null, h3("img", { className: "df-sticker", src: `data:${image.mime};base64,${image.data}`, alt: "\u6536\u96C6\u7684\u8868\u60C5\u539F\u4EF6" }), h3(Button2, { onClick: () => setImage(null) }, "\u5173\u95ED\u9884\u89C8")), edit && h3("div", { className: "df-editor" }, h3("h4", null, "\u7F16\u8F91\u7D20\u6750\u8D44\u6599"), ...["name", "description", "tags"].map((key) => h3("label", { key }, { name: "\u540D\u79F0", description: "\u8BF4\u660E", tags: "\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF09" }[key], h3("input", { value: edit[key], onChange: (e) => setEdit({ ...edit, [key]: e.target.value }) }))), h3(Button2, { onClick: () => perform(async () => {
    await call("stickers.update", { id: edit.id, expectedVersion: edit.version, name: edit.name, description: edit.description, tags: edit.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) });
    setEdit(null);
    await load();
  }), primary: true }, "\u4FDD\u5B58\u8D44\u6599"), h3(Button2, { onClick: () => setEdit(null) }, "\u53D6\u6D88\u7F16\u8F91")), h3("div", { className: "df-actions" }, h3(Button2, { disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 50)) }, "\u4E0A\u4E00\u9875"), h3("span", null, `\u8D77\u59CB\u8BB0\u5F55 ${offset + 1}\uFF0C\u70B9\u51FB\u8BFB\u53D6\u5237\u65B0`), h3(Button2, { disabled: (rows?.length ?? 0) < 50, onClick: () => setOffset(offset + 50) }, "\u4E0B\u4E00\u9875")));
}
var managementPanels3 = [{ id: "stickers", component: StickerPanel }];

// packages/activity/client/management.js
var import_react4 = __toESM(require("react"), 1);
var h4 = import_react4.default.createElement;
function ActivityPanel({ call, perform, ui: { Button: Button2, Detail: Detail2 } }) {
  const [value, setValue] = import_react4.default.useState(null);
  const load = async () => setValue(await call("status", null));
  return h4("div", null, h4(Button2, { onClick: () => perform(load) }, "\u8BFB\u53D6\u8F6E\u6B21\u4E0E\u8BA1\u5212"), value && h4(import_react4.default.Fragment, null, h4("h4", null, "\u6700\u8FD1\u6D3B\u52A8\u8F6E\u6B21"), ...(value.rounds ?? []).map((round) => h4("article", { key: round.id, className: "df-record" }, h4("strong", null, round.endedAt === null ? "\u8FDB\u884C\u4E2D\u7684\u8F6E\u6B21" : "\u5DF2\u7ED3\u675F\u7684\u8F6E\u6B21"), h4("p", null, `\u5DF2\u5B8C\u6210 ${round.completed} \u9879 \xB7 ${(round.knownTokens / 1e4).toFixed(3)} \u4E07 Token${round.unknown ? "\uFF08\u53E6\u6709\u7528\u91CF\u5F85\u6838\u5B9E\uFF09" : ""} \xB7 ${(round.durationMs / 6e4).toFixed(2)} \u5206\u949F`), h4(Detail2, { title: "\u9884\u7B97\u5FEB\u7167\u4E0E\u7ED3\u675F\u539F\u56E0", value: round }))), h4("h4", null, "\u5DF2\u6709\u8BA1\u5212"), ...(value.plans ?? []).map((plan) => h4("article", { key: plan.body.id, className: "df-record" }, h4("strong", null, plan.body.goal), h4("p", { className: "df-muted" }, `${plan.status} \xB7 ${plan.body.purpose}`), h4(Detail2, { title: "\u89E6\u53D1\u6761\u4EF6\u4E0E\u6388\u6743\u4F9D\u636E", value: plan }), h4("div", { className: "df-actions" }, ...["paused", "active", "cancelled"].map((state) => h4(Button2, { key: state, disabled: plan.body.state === "cancelled" || plan.body.state === state, onClick: () => perform(async () => {
    await call("plan.update", { id: plan.body.id, requestId: crypto.randomUUID(), expectedVersion: plan.body.version, state });
    await load();
  }) }, { paused: "\u6682\u505C\u540E\u7EED\u6267\u884C", active: "\u6062\u590D\u8BA1\u5212", cancelled: "\u53D6\u6D88\u8BA1\u5212" }[state])))))));
}
var managementPanels4 = [{ id: "activity", component: ActivityPanel }];

// packages/plugin/client/app.js
var import_react5 = __toESM(require("react"), 1);
var h5 = import_react5.default.createElement;
var tabs = [["overview", "\u603B\u89C8"], ["personality", "\u4EBA\u683C\u4E0E\u8BB0\u5FC6"], ["capabilities", "\u80FD\u529B"], ["tasks", "\u4EFB\u52A1\u4E0E\u8BB0\u5F55"], ["prompts", "\u63D0\u793A\u8BCD\u9884\u89C8"], ["runtime", "\u8FD0\u884C"]];
var stateLabels = { running: "\u8FD0\u884C\u4E2D", starting: "\u542F\u52A8\u4E2D", stopped: "\u5DF2\u505C\u6B62", stopping: "\u6B63\u5728\u505C\u6B62", failed: "\u542F\u52A8\u6216\u8FD0\u884C\u5931\u8D25" };
var pretty = (value) => JSON.stringify(value, null, 2);
function Detail({ title, value }) {
  return h5("details", { className: "df-detail" }, h5("summary", null, title), h5("pre", null, typeof value === "string" ? value : pretty(value)));
}
function Button({ onClick, children, disabled = false, primary = false }) {
  return h5("button", { type: "button", onClick, disabled, className: primary ? "df-primary" : "" }, children);
}
var panelRegistry = new Map([...managementPanels, ...managementPanels2, ...managementPanels3, ...managementPanels4].map((panel) => [panel.id, panel.component]));
function RemotePanel({ module: module2, panel, call, perform }) {
  const [value, setValue] = import_react5.default.useState(null), Component = panelRegistry.get(panel);
  if (Component)
    return h5(Component, { call: (action, input) => call(module2, action, input), perform, ui: { Button, Detail } });
  return h5("div", null, h5(Button, { onClick: () => perform(async () => setValue(await call(module2, "status", null))) }, "\u8BFB\u53D6\u5F53\u524D\u72B6\u6001"), module2 === "qq" && h5(Button, { onClick: () => perform(async () => setValue(await call(module2, "connection.check", null))) }, "\u68C0\u67E5\u7EC4\u4EF6\u8FDE\u901A"), value ? h5(Detail, { title: "\u5F53\u524D\u6A21\u5757\u72B6\u6001", value }) : h5("p", { className: "df-muted" }, "\u672A\u8FDE\u63A5\u5B9E\u4F8B\u65F6\u4E0D\u663E\u793A\u793A\u4F8B\u72B6\u6001\u3002"));
}
function Field({ field, value, onChange }) {
  const scale = field.scale ?? 1;
  const displayed = value == null ? "" : field.kind === "json" ? pretty(value) : field.kind === "lines" ? (value ?? []).join("\n") : field.kind === "number" ? value / scale : value;
  let input;
  if (field.kind === "choices") input = h5("div", { className: "df-field-group" }, ...(field.options ?? []).map((option) => h5("label", { key: option.value }, h5("input", { type: "checkbox", checked: (value ?? []).includes(option.value), onChange: (e) => onChange(e.target.checked ? [...value ?? [], option.value] : (value ?? []).filter((item) => item !== option.value)) }), option.label)));
  else if (field.kind === "select") input = h5("select", { value: value ?? "", onChange: (e) => onChange(e.target.value || null) }, h5("option", { value: "" }, "\u4F7F\u7528\u9ED8\u8BA4\u503C"), ...(field.options ?? []).map((option) => h5("option", { key: option.value, value: option.value }, option.label)));
  else if (field.kind === "time-windows") input = h5("div", null, ...(value ?? []).map((window, index) => h5("div", { key: index, className: "df-actions" }, h5("input", { type: "time", value: window.start, "aria-label": "\u5F00\u59CB\u65F6\u95F4 " + (index + 1), onChange: (e) => onChange(value.map((entry, i) => i === index ? { ...entry, start: e.target.value } : entry)) }), h5("span", null, "\u81F3"), h5("input", { type: "time", value: window.end, "aria-label": "\u7ED3\u675F\u65F6\u95F4 " + (index + 1), onChange: (e) => onChange(value.map((entry, i) => i === index ? { ...entry, end: e.target.value } : entry)) }), h5(Button, { onClick: () => onChange(value.filter((_entry, i) => i !== index)) }, "\u5220\u9664\u65F6\u6BB5"))), h5(Button, { disabled: (value?.length ?? 0) >= 8, onClick: () => onChange([...value ?? [], { start: "22:00", end: "08:00" }]) }, "\u6DFB\u52A0\u5B89\u9759\u65F6\u6BB5"));
  else if (field.kind === "numbers") input = h5("textarea", { rows: 3, value: (value ?? []).map((item) => item / scale).join("\n"), onChange: (e) => onChange(e.target.value.split("\n").map((item) => item.trim()).filter(Boolean).map((item) => Number(item) * scale)) });
  else if (field.kind === "boolean")
    input = h5("input", { type: "checkbox", checked: !!value, onChange: (e) => onChange(e.target.checked) });
  else if (field.kind === "json" || field.kind === "lines")
    input = h5("textarea", { rows: field.kind === "json" ? 5 : 3, value: displayed, onChange: (e) => onChange(field.kind === "lines" ? e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) : { draftJson: e.target.value }) });
  else
    input = h5("input", { type: field.kind === "number" ? "number" : "text", value: displayed, min: field.minimum, max: field.maximum, step: "any", onChange: (e) => onChange(e.target.value === "" ? null : field.kind === "number" ? Number(e.target.value) * scale : e.target.value) });
  if (value && typeof value === "object" && "draftJson" in value)
    input = h5("textarea", { rows: 5, value: value.draftJson, onChange: (e) => onChange({ draftJson: e.target.value }) });
  return h5(["choices", "time-windows"].includes(field.kind) ? "div" : "label", { className: "df-field" }, h5("span", null, field.label, field.unit && h5("small", null, " \xB7 " + field.unit)), input, h5("small", null, field.description));
}
function Module({ module: module2, configuration, drafts, changeDraft, call, perform, save }) {
  const draft = drafts[module2.id] ?? {};
  return h5("div", null, h5("h2", null, module2.title), h5("p", { className: "df-lead" }, module2.description), ...module2.sections.map((section) => h5("section", { key: section.id, id: `df-${module2.id}-${section.id}`, className: "df-section" }, h5("h3", null, section.title), h5("p", { className: "df-muted" }, section.description), ...section.fields.map((field) => h5(Field, { key: field.path, field, value: Object.hasOwn(draft, field.path) ? draft[field.path] : configuration?.values?.[field.path], onChange: (value) => changeDraft(module2.id, field.path, value) })), section.id === "delay" && h5("p", { className: "df-note" }, "\u793A\u4F8B\uFF1A\u6309\u9ED8\u8BA4\u89C4\u5219\uFF0C50 \u5B57\u56DE\u590D\u7B49\u5F85 3 \u79D2\uFF1B500 \u5B57\u8FBE\u5230 10 \u79D2\u4E0A\u9650\u3002"), section.optionalPath && h5(Button, { onClick: () => changeDraft(module2.id, section.optionalPath, null) }, "\u79FB\u9664\u6B64\u9879\u7EC4\u4EF6\u914D\u7F6E"), section.panel && h5(RemotePanel, { module: module2.id, panel: section.panel, call, perform }))), module2.sections.some((section) => section.fields.length) && h5("div", { className: "df-save" }, h5("span", null, Object.keys(draft).length ? `${Object.keys(draft).length} \u4E2A\u672A\u4FDD\u5B58\u5B57\u6BB5` : "\u914D\u7F6E\u4E0E\u6587\u4EF6\u4E00\u81F4"), h5(Button, { disabled: !configuration?.revision || !Object.values(drafts).some((value) => Object.keys(value).length), onClick: () => perform(() => save(module2.id)), primary: true }, "\u4FDD\u5B58\u5168\u90E8\u914D\u7F6E\u8349\u7A3F")));
}
function createManagementApp(request) {
  return function ManagementApp() {
    const [view, setView] = import_react5.default.useState(null), [tab, setTab] = import_react5.default.useState("overview"), [selected, setSelected] = import_react5.default.useState(null), [busy, setBusy] = import_react5.default.useState(false), [notice, setNotice] = import_react5.default.useState(""), [drafts, setDrafts] = import_react5.default.useState({}), [foundation, setFoundation] = import_react5.default.useState(null);
    const invoke = async (body) => {
      const result = await request(body);
      if (!result.ok)
        throw new Error(result.code + (result.fields?.length ? "\uFF1A" + result.fields.join("\u3001") : ""));
      return result.value;
    };
    const refresh = async () => setView(await invoke({ kind: "describe" }));
    const perform = async (work) => {
      if (busy)
        return;
      setBusy(true);
      setNotice("");
      try {
        await work();
      } catch (error) {
        setNotice(error.message);
      } finally {
        setBusy(false);
      }
    };
    import_react5.default.useEffect(() => {
      void perform(refresh);
    }, []);
    const call = (module2, action, input) => invoke({ kind: "module", module: module2, action, input });
    const navigate = (target, module2 = null) => {
      setTab(target);
      setSelected(module2);
    };
    const save = async () => {
      const changes = [];
      for (const [module2, draft] of Object.entries(drafts)) {
        const values = {};
        for (const [key, value] of Object.entries(draft))
          values[key] = value && typeof value === "object" && "draftJson" in value ? value.draftJson.trim() ? JSON.parse(value.draftJson) : null : value;
        if (Object.keys(values).length)
          changes.push({ module: module2, values });
      }
      const saved = await invoke({ kind: "save", revision: view.configuration.revision, changes });
      setDrafts((current) => Object.fromEntries(Object.entries(current).map(([module2, fields]) => [module2, Object.fromEntries(Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(drafts[module2]?.[key])))])));
      await refresh();
      setNotice(saved.notice ?? (saved.applies === "next-round" ? "\u9884\u7B97\u5DF2\u4FDD\u5B58\uFF1B\u5F53\u524D\u8F6E\u4FDD\u6301\u539F\u9884\u7B97\uFF0C\u4E0B\u4E00\u8F6E\u5E94\u7528\u65B0\u9884\u7B97\u3002" : "\u5DF2\u4FDD\u5B58\u3002\u5F53\u524D\u8FD0\u884C\u4E0D\u53D8\uFF0C\u4E0B\u6B21\u542F\u52A8\u4F7F\u7528\u65B0\u914D\u7F6E\u3002"));
    };
    const modules = view?.modules ?? [], active = modules.find((module2) => module2.id === selected), status = view?.runtime?.state ?? "loading";
    return h5("main", { className: "df-app", "aria-busy": busy }, h5("header", { className: "df-header" }, h5("div", null, h5("p", { className: "df-eyebrow" }, "DAFEIYU \xB7 \u7BA1\u7406"), h5("h1", null, "\u5927\u80A5\u9C7C\u7BA1\u7406\u4E2D\u5FC3"), h5("p", null, "\u67E5\u770B\u5979\u7684\u6210\u957F\uFF0C\u7BA1\u7406\u5979\u4F7F\u7528\u7684\u80FD\u529B\u3002")), h5("span", { className: "df-badge" }, stateLabels[status] ?? "\u6B63\u5728\u8BFB\u53D6")), h5("nav", { className: "df-tabs", "aria-label": "\u7BA1\u7406\u4E2D\u5FC3\u9875\u9762" }, ...tabs.map(([id, label]) => h5("button", { key: id, type: "button", "aria-current": tab === id ? "page" : void 0, onClick: () => navigate(id) }, label))), notice && h5("div", { className: "df-notice", role: "status" }, notice), busy && h5("p", { role: "status" }, "\u6B63\u5728\u5904\u7406\u2026"), view?.configuration?.error && h5("div", { className: "df-notice" }, "\u914D\u7F6E\u5C1A\u672A\u5C31\u7EEA\uFF1A\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6307\u5B9A\u914D\u7F6E\u6587\u4EF6\uFF0C\u7136\u540E\u586B\u5199\u4E0B\u5217\u6A21\u5757\u7F3A\u5931\u7684\u5B57\u6BB5\uFF1B\u6240\u6709\u8349\u7A3F\u4F1A\u4E00\u8D77\u4FDD\u5B58\u3002", h5("p", null, (view.configuration.fields ?? []).join("\u3001"))), tab === "overview" && h5("div", null, h5("section", { className: "df-section" }, h5("h2", null, "\u966A\u4F34\u4E0E\u6210\u957F"), h5("p", null, "\u4EBA\u683C\u6765\u81EA\u8BB0\u5FC6\u3002\u80FD\u529B\u63D0\u4F9B\u63A5\u53E3\u548C\u4F7F\u7528\u6D41\u7A0B\uFF0C\u7ECF\u5386\u4E0E\u81EA\u5DF1\u7684\u770B\u6CD5\u5206\u522B\u7559\u5B58\u3002"), h5("div", { className: "df-actions" }, h5(Button, { onClick: () => navigate("personality", "memory") }, "\u67E5\u770B\u4EBA\u683C\u4E0E\u8BB0\u5FC6"), h5(Button, { onClick: () => navigate("prompts") }, "\u67E5\u770B\u63D0\u793A\u8BCD\u7EC4\u88C5"))), h5("h2", null, "\u6A21\u5757\u7BA1\u7406"), h5("div", { className: "df-cards" }, ...modules.filter((m) => m.id !== "tasks").map((module2) => h5("button", { key: module2.id, className: "df-card", onClick: () => navigate(module2.tab, module2.id) }, h5("strong", null, module2.title), h5("span", null, module2.description)))), h5("p", { className: "df-muted" }, `\u7A0B\u5E8F\u7248\u672C ${view?.version ?? "\u2026"} \xB7 API ${view?.apiVersion ?? "\u2026"} \xB7 \u8FD0\u884C\u72B6\u6001\u4EE5\u5B9E\u4F8B\u8FD4\u56DE\u4E3A\u51C6`)), ["capabilities", "runtime", "personality"].includes(tab) && h5(import_react5.default.Fragment, null, h5("div", { className: "df-module-tabs" }, ...modules.filter((m) => m.tab === tab && m.id !== "tasks").map((module2) => h5(Button, { key: module2.id, onClick: () => setSelected(module2.id), primary: active?.id === module2.id }, module2.title))), active && active.tab === tab ? h5(Module, { module: active, configuration: view.configuration, drafts, changeDraft: (id, key, value) => setDrafts((old) => ({ ...old, [id]: { ...old[id], [key]: value } })), call, perform, save }) : h5("p", { className: "df-muted" }, "\u9009\u62E9\u4E00\u4E2A\u6A21\u5757\u67E5\u770B\u8BE6\u7EC6\u8BBE\u7F6E\u3002"), tab === "runtime" && h5("div", { className: "df-actions" }, ...["start", "stop", "restart"].map((action) => h5(Button, { key: action, disabled: busy, onClick: () => perform(async () => {
      await invoke({ kind: "runtime", action });
      await refresh();
    }) }, { start: "\u542F\u52A8\u5B9E\u4F8B", stop: "\u505C\u6B62\u5B9E\u4F8B", restart: "\u91CD\u542F\u5E76\u5E94\u7528\u914D\u7F6E" }[action])), h5(Button, { onClick: () => perform(refresh) }, "\u5237\u65B0\u8FD0\u884C\u72B6\u6001"))), tab === "tasks" && h5("section", { className: "df-section" }, h5("h2", null, "\u4EFB\u52A1\u4E0E\u8BB0\u5F55"), h5("p", { className: "df-muted" }, "\u67E5\u770B\u6982\u51B5\u3001\u6267\u884C\u56DE\u6267\u3001\u7ED3\u679C\u3001\u7528\u91CF\u548C\u4E0A\u4E0B\u6587\uFF1B\u672A\u77E5\u6548\u679C\u4E0D\u4F1A\u901A\u8FC7\u7EE7\u7EED\u6309\u94AE\u81EA\u52A8\u91CD\u6F14\u3002"), h5(RemotePanel, { module: "tasks", panel: "tasks", call, perform })), tab === "prompts" && h5("div", null, h5("h2", null, "\u63D0\u793A\u8BCD\u6587\u672C\u9884\u89C8"), h5("p", { className: "df-lead" }, "\u7A33\u5B9A\u89C4\u5219\u4E0E\u5E95\u8272\u6784\u6210\u524D\u7F00\u3002\u5408\u6CD5\u5386\u53F2\u4FDD\u7559\uFF0C\u65B0\u72B6\u6001\u4EE5\u5B8C\u6574\u5FEB\u7167\u8FFD\u52A0\uFF1B\u6700\u540E\u4E00\u4EFD\u5FEB\u7167\u4EE3\u8868\u5F53\u524D\u72B6\u6001\u3002"), h5("p", { className: "df-note" }, "\u989C\u8272\u4E0E\u6765\u6E90\u6807\u7B7E\u53EA\u7528\u4E8E\u754C\u9762\u3002\u9884\u89C8\u4E0D\u8C03\u7528\u6A21\u578B\uFF0C\u4E0D\u8BFB\u53D6\u4F1A\u8BDD\u539F\u6587\uFF0C\u4E5F\u4E0D\u6267\u884C\u4E0A\u4E0B\u6587 prepare\u3002"), h5(Button, { onClick: () => perform(async () => {
      const value = await call("memory", "status", null);
      setFoundation(value.foundation);
    }) }, "\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684\u8EAB\u4EFD\u5E95\u8272"), ...["system", "context", "history", "tools"].map((position) => h5("section", { key: position, className: "df-section" }, h5("h3", null, { system: "\u7A33\u5B9A\u7CFB\u7EDF\u63D0\u793A\u8BCD", context: "\u672C\u8F6E\u4E0A\u4E0B\u6587\u589E\u91CF", history: "\u6709\u6548\u5386\u53F2", tools: "\u5DE5\u5177\u5B9A\u4E49\uFF08\u72EC\u7ACB\u5B57\u6BB5\uFF09" }[position]), ...[...view?.prompts ?? [], ...modules.flatMap((m) => m.prompts), { id: "history", module: "tasks", title: "\u4F1A\u8BDD\u3001\u5DE5\u5177\u56DE\u6267\u4E0E\u6709\u6548\u5386\u53F2", position: "history", dynamic: true, condition: "\u6309\u771F\u5B9E\u4F1A\u8BDD\u4E0E\u6765\u6E90\u8303\u56F4\u8BFB\u53D6" }].filter((p) => p.position === position).sort((a, b) => (a.id === "foundation" ? -1 : 0) - (b.id === "foundation" ? -1 : 0)).map((prompt) => h5("details", { key: prompt.id, className: `df-prompt df-source-${prompt.module}`, open: !!prompt.dynamic }, h5("summary", null, prompt.title), h5("button", { className: "df-source-link", onClick: () => {
      const owner = modules.find((m) => m.id === prompt.module);
      navigate(owner?.tab ?? "runtime", owner?.id ?? "runtime");
    } }, "\u6765\u6E90\uFF1A" + (modules.find((m) => m.id === prompt.module)?.title ?? prompt.module)), h5("p", { className: "df-muted" }, prompt.condition), h5("pre", null, prompt.dynamic ? "\u3010\u52A8\u6001\u63D0\u793A\u8BCD\u3011" : prompt.id === "foundation" ? foundation?.text ?? "\u8BF7\u8FDE\u63A5\u5B9E\u4F8B\u5E76\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684\u5E95\u8272\u3002" : prompt.text ?? "\u672A\u63D0\u4F9B\u9759\u6001\u6B63\u6587"), prompt.source && h5("small", null, prompt.source)))))), h5("footer", { className: "df-footer" }, h5("span", null, "\u914D\u7F6E\u4E0E\u5B9E\u9645\u8FD0\u884C\u5206\u5F00\u5448\u73B0"), h5(Button, { disabled: busy, onClick: () => perform(refresh) }, "\u5237\u65B0\u7BA1\u7406\u4E2D\u5FC3")));
  };
}

// packages/plugin/client/style.css
var style_default = ".df-app{font:14px/1.65 system-ui,sans-serif;color:inherit;max-width:1100px;margin:auto;padding:8px 0 28px;--df-accent:#237f95;--df-line:color-mix(in srgb,currentColor 13%,transparent);--df-soft:color-mix(in srgb,#55b8c6 8%,transparent)}.df-app *{box-sizing:border-box}.df-app h1{font-size:27px;letter-spacing:-.04em;line-height:1.3;margin:4px 0 8px}.df-app h2{font-size:21px;line-height:1.4;margin:24px 0 8px}.df-app h3{font-size:16px;margin:0 0 8px}.df-app h4{margin:4px 0 12px}.df-app p{margin:6px 0 14px}.df-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:24px}.df-eyebrow{font-size:11px;font-weight:700;letter-spacing:.15em;color:var(--df-accent)}.df-badge{white-space:nowrap;border:1px solid var(--df-line);border-radius:20px;padding:5px 10px;font-size:12px}.df-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--df-line);padding-bottom:8px;margin-bottom:22px}.df-app button{font:inherit;cursor:pointer;border:1px solid var(--df-line);border-radius:7px;padding:7px 11px;background:transparent;color:inherit}.df-app button:hover{background:var(--df-soft)}.df-app button:disabled{opacity:.45;cursor:not-allowed}.df-app button:focus-visible,.df-app input:focus-visible,.df-app textarea:focus-visible{outline:2px solid var(--df-accent);outline-offset:2px}.df-app button[aria-current=page],.df-app .df-primary{background:var(--df-accent);color:white;border-color:var(--df-accent)}.df-section{padding:22px 0;border-bottom:1px solid var(--df-line)}.df-section:first-child{padding-top:8px}.df-lead{font-size:14px;opacity:.8}.df-muted,.df-field small{font-size:12px;opacity:.68}.df-note{border-left:3px solid var(--df-accent);background:var(--df-soft);padding:12px 16px;font-size:12px}.df-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.df-app .df-card{display:flex;flex-direction:column;gap:8px;text-align:left;padding:20px}.df-card strong{font-size:16px}.df-card span{font-size:12px;opacity:.7}.df-field{display:grid;grid-template-columns:minmax(130px,1fr) minmax(160px,1.6fr);gap:4px 16px;align-items:center;margin:16px 0}.df-field>small{grid-column:2}.df-field>span small{white-space:nowrap}.df-app input:not([type=checkbox]),.df-app textarea{background:transparent;color:inherit;font:inherit;width:100%;min-width:0;border:1px solid var(--df-line);border-radius:6px;padding:8px}.df-app textarea{resize:vertical;line-height:1.5;font-family:ui-monospace,monospace;font-size:12px}.df-field input[type=checkbox]{justify-self:start;width:18px;height:18px;accent-color:var(--df-accent)}.df-actions,.df-module-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}.df-actions>input{max-width:220px}.df-save{position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--df-line);border-radius:8px;background:Canvas;color:CanvasText}.df-notice{padding:12px;border:1px solid #c28e49;border-radius:6px;overflow-wrap:anywhere}.df-record{padding:15px 0;border-bottom:1px solid var(--df-line)}.df-record strong{overflow-wrap:anywhere}.df-app pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 ui-monospace,monospace;max-height:420px;overflow:auto}.df-detail{margin:8px 0}.df-app summary{cursor:pointer;font-weight:600}.df-prompt{border-left:3px solid #5f8eb9;background:var(--df-soft);padding:16px;margin:12px 0}.df-source-memory{border-color:#9873bb}.df-source-qq{border-color:#2d9b8b}.df-source-media{border-color:#bd8f42}.df-source-activity{border-color:#b27685}.df-app .df-source-link{border:0;padding:5px 0;font-size:12px;color:var(--df-accent)}.df-editor{border:1px solid var(--df-line);border-radius:8px;padding:16px;margin:16px 0}.df-editor label{display:block;margin:12px 0}.df-sticker{max-width:240px;max-height:240px;display:block}.df-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--df-line);margin-top:30px;padding-top:14px;font-size:12px;opacity:.75}@media(max-width:600px){.df-header{display:block}.df-field{grid-template-columns:1fr}.df-field>small{grid-column:1}.df-tabs{gap:6px}.df-tabs button{font-size:12px;padding:6px 8px}.df-save{flex-wrap:wrap}.df-cards{grid-template-columns:1fr 1fr}.df-card span{display:none}}\n\n.df-app select{font:inherit;color:inherit;background:Canvas;border:1px solid var(--df-line);border-radius:6px;padding:8px}.df-field-group{display:flex;gap:14px;flex-wrap:wrap}.df-field-group label{display:flex;gap:6px;align-items:center}.df-field input[type=time]{width:110px}\n";

// packages/plugin/lib/management-remote.js
var managementRemote = { package: "dsh-dafeiyu", descriptors: [{ id: "dsh-dafeiyu#dafeiyuManagement/request", service: "dafeiyuManagement", namespace: "dafeiyuManagement", method: "request", invocation: { kind: "direct" }, parameters: [{ name: "payload", wire: "payload", source: "json", codec: { mode: "src-json" } }], result: { mode: "src-json" } }] };

// packages/plugin/client/index.js
var inject = ["slots", "remote"];
async function apply(ctx) {
  const unmount = await ctx.remote.$mount(managementRemote);
  ctx.effect(() => unmount);
  const request = async (body) => {
    const result = await ctx.remote.dafeiyuManagement.request(JSON.stringify(body));
    if (!result.ok)
      throw new Error(result.error.code);
    return JSON.parse(result.value);
  };
  const App = createManagementApp((body) => request({ apiVersion: 5, ...body }));
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = style_default;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "dafeiyu", order: 80, label: () => "\u5927\u80A5\u9C7C\u7BA1\u7406\u4E2D\u5FC3" }, App));
}

return module.exports;}});
