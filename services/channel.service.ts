import { channel } from "diagnostics_channel";
import { Context, Service, ServiceSchema, Errors } from "moleculer";
import { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import ForbiddenError from "moleculer-db";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import slug from "slug";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError } = Errors;

export interface ChannelEntity {
	_id: string;
	title: string;
	description: string;
	quantity: number;
}

interface Meta {
	user?: ChannelEntity | null | undefined;
}

export type ActionCreateParams = Partial<ChannelEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
	channel: any;
	creator: string;
	limit: any;
	offset: any;
	slug: any;
	topic: any;

	title: string;
	follow: string;
}

interface ChannelSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
}

interface ChannelThis extends Service<ChannelSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const ChannelService: ServiceSchema<ChannelSettings> & { methods: DbServiceMethods } = {
	name: "channels",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("channels")],

	/**
	 * Settings
	 */
	settings: {
		// Available fields in the responses
		fields: ["_id", "title", "slug", "description", "createdAt", "updatedAt", "creator"],

		// Validator for the `create` & `insert` actions.
		entityValidator: {
			title: "string|min:3",
			description: "string|min:3",
		},

		populates: {
			creator: {
				action: "users.get",
				params: {
					fields: ["username", "bio", "image"],
				},
			},
		},
	},

	/**
	 * Actions
	 */
	actions: {
		/**
		 * The "moleculer-db" mixin registers the following actions:
		 *  - list
		 *  - find
		 *  - count
		 *  - create
		 *  - insert
		 *  - update
		 *  - remove
		 */

		/**
		 * Create a new channel.
		 * Auth is required!
		 *
		 * @actions
		 * @param {Object} channel - Channel entity
		 *
		 * @returns {Object} Created entity
		 */
		create: {
			auth: "required",
			params: {
				channel: { type: "object" },
			},
			meta: {
				user: "",
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				let entity = ctx.params.channel;
				return this.validateEntity(entity).then(() => {
					const { user } = ctx.meta;
					entity.slug =
						slug(entity.title, { lower: true }) +
						"-" +
						((Math.random() * Math.pow(36, 6)) | 0).toString(36);
					entity.creator = user?._id.toString();
					entity.createdAt = new Date();
					entity.updatedAt = new Date();

					return this.adapter
						.insert(entity)
						.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
						.then((entity) => this.transformResult(ctx, entity, ctx.meta.user))
						.then((json) => this.entityChanged("created", json, ctx).then(() => json));
				});
			},
		},

		/**
		 * List channel with pagination.
		 *
		 * @actions
		 * @param {String} creator - Filter for creator ID
		 * @param {Number} limit - Pagination limit
		 * @param {Number} offset - Pagination offset
		 *
		 * @returns {Object} List of channel
		 */
		list: {
			cache: {
				keys: ["#token", "creator", "limit", "offset"],
			},
			params: {
				creator: { type: "string", optional: true },
				limit: { type: "number", optional: true, convert: true },
				offset: { type: "number", optional: true, convert: true },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
				const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

				let params: any = {
					limit,
					offset,
					sort: ["-createdAt"],
					populate: ["creater"],
					query: {},
				};
				let countParams: any;

				return Promise.resolve()
					.then(() => {
						if (ctx.params.creator) {
							return ctx
								.call("users.find", { query: { username: ctx.params.creator } })
								.then((channels: any) => {
									if (channels.length == 0)
										return Promise.reject(
											new MoleculerClientError("Channel not found"),
										);

									params.query.creator = channels[0]._id;
								});
						}
					})
					.then(() => {
						countParams = Object.assign({}, params);
						// Remove pagination params
						if (countParams && countParams.limit) countParams.limit = null;
						if (countParams && countParams.offset) countParams.offset = null;
					})
					.then(() => {
						return Promise.all([
							// Get rows
							this.adapter.find(params),

							// Get count of all rows
							this.adapter.count(countParams),
						]);
					})
					.then((res) => {
						return this.transformDocuments(ctx, params, res[0])
							.then((docs: any) => this.transformResult(ctx, docs, ctx.meta.user))
							.then((r: any) => {
								r.count = res[1];
								return r;
							});
					});
			},
		},

		/**
		 * Get an channel by slug
		 *
		 * @actions
		 * @param {String} id - Channel slug
		 *
		 * @returns {Object} Channel entity
		 */
		get: {
			cache: {
				keys: ["#token", "id"],
			},
			params: {
				id: { type: "string" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				return this.findBySlug(ctx.params.id)
					.then((entity: any) => {
						if (!entity)
							return Promise.reject(
								new MoleculerClientError("Channel not found!", 404),
							);

						return entity;
					})
					.then((doc: any) =>
						this.transformDocuments(ctx, { populate: ["creator"] }, doc),
					)
					.then((entity: any) => this.transformResult(ctx, entity, ctx.meta.user));
			},
		},

		/**
		 * Update an Channel.
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} id - Channel ID
		 * @param {Object} article - Channel modified fields
		 *
		 * @returns {Object} Updated entity
		 */
		update: {
			auth: "required",
			params: {
				id: { type: "string" },
				channel: {
					type: "object",
					props: {
						title: { type: "string", min: 1, optional: true },
						description: { type: "string", min: 1, optional: true },
					},
				},
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				let newData = ctx.params.channel;
				newData.updatedAt = new Date();
				// the 'id' is the slug
				return Promise.resolve(ctx.params.id)
					.then((slug) => this.findBySlug(slug))
					.then((channel) => {
						if (!channel)
							return Promise.reject(
								new MoleculerClientError("Channel not found", 404),
							);

						if (channel.creator !== ctx.meta.user?._id.toString())
							return Promise.reject(
								new MoleculerClientError(
									"This belong to " + `${channel.creator}`,
									500,
								),
							);

						const update = {
							$set: newData,
						};

						return this.adapter.updateById(channel._id, update);
					})
					.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
					.then((entity) => this.transformResult(ctx, entity, ctx.meta.user))
					.then((json) => this.entityChanged("updated", json, ctx).then(() => json));
			},
		},

		/**
		 * Add a new topic to an article.
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} slug - Channel slug
		 * @param {Object} topic - Topic fields
		 *
		 * @returns {Object} Topic entity
		 */
		addTopics: {
			auth: "required",
			params: {
				slug: { type: "string" },
				topic: { type: "object" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				return Promise.resolve(ctx.params.slug)
					.then((slug: string) => this.findBySlug(slug))
					.then((channel: any) => {
						if (!channel)
							return Promise.reject(
								new MoleculerClientError("Channel not found", 404),
							);

						return ctx.call("topics.create", {
							channel: channel._id.toString(),
							topic: ctx.params.topic,
						});
					});
			},
		},

		/**
		 * Join an Channel
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} id - Channel slug
		 *
		 * @returns {Object} Updated article
		 */
		join: {
			auth: "required",
			params: {
				slug: { type: "string" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				return Promise.resolve(ctx.params.slug)
					.then((slug) => this.findBySlug(slug))
					.then((channel) => {
						console.log("*****");
						console.log("*****");
						console.log(channel);
						if (!channel)
							return Promise.reject(
								new MoleculerClientError("Channel not found", 404),
							);

						return ctx
							.call("follows.add", {
								channel: channel._id.toString(),
								user: ctx.meta.user?._id.toString(),
							})
							.then(() => channel);
					})
					.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
					.then((entity) => this.transformResult(ctx, entity, ctx.meta.user));
			},
		},

		/**
		 * Leave channel
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} id - Channel slug
		 *
		 * @returns {Object} Updated article
		 */
		leave: {
			auth: "required",
			params: {
				slug: { type: "string" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				return Promise.resolve(ctx.params.slug)
					.then((slug: any) => this.findBySlug(slug))
					.then((channel: any) => {
						if (!channel)
							return Promise.reject(
								new MoleculerClientError("Channel not found", 404),
							);

						return ctx
							.call("follows.delete", {
								channel: channel._id.toString(),
								user: ctx.meta.user?._id.toString(),
							})
							.then(() => channel);
					})
					.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
					.then((entity) => this.transformResult(ctx, entity, ctx.meta.user));
			},
		},

		/**
		 * Get all topics of an channel.
		 *
		 * @actions
		 * @param {String} slug - Channel slug
		 *
		 * @returns {Object} Topic list
		 *
		 */
		topics: {
			cache: {
				keys: ["#token", "slug"],
			},
			params: {
				slug: { type: "string" },
			},
			handler(ctx: Context<ActionQuantityParams, Meta>) {
				return Promise.resolve(ctx.params.slug)
					.then((slug) => this.findBySlug(slug))
					.then((channel) => {
						if (!channel)
							return Promise.reject(
								new MoleculerClientError("Channel not found", 404),
							);

						return ctx.call("topics.list", {
							channel: channel._id.toString(),
						});
					});
			},
		},
	},

	/**
	 * Methods
	 */
	methods: {
		/**
		 * Find an Channel by slug
		 *
		 * @param {String} slug - Channel slug
		 *
		 * @results {Object} Promise<Channel>
		 */
		findBySlug(slug) {
			return this.adapter.findOne({ slug });
		},

		/**
		 *
		 * @param {Context} ctx
		 * @param {Array} entities
		 * @param {Object} user - Logged in user
		 */
		transformResult(this: any, ctx, entities, user) {
			if (Array.isArray(entities)) {
				return this.Promise.mapSeries(entities, (item: any) =>
					this.transformEntity(ctx, item, user),
				).then((channels: any) => ({ channels }));
			} else {
				return this.transformEntity(ctx, entities, user).then((channel: any) => ({
					channel,
				}));
			}
		},
		/**
		 *
		 * @param {Context} ctx
		 * @param {Object} entity
		 * @param {Object} user - Logged in user
		 */
		transformEntity(ctx, entity, user) {
			if (!entity) return Promise.resolve();
			return Promise.resolve(entity);
		},
	},

	events: {
		"cache.clean.channels"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.users"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.topics"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
	},
};

export default ChannelService;
