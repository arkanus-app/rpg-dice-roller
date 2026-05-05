import Description from '../Description.js';

const descriptionSymbol: unique symbol = Symbol('description');

export interface HasDescriptionJSON {
  description: Description | null;
}

/**
 * A base class for description functionality.
 *
 * @abstract
 */
class HasDescription {
  private [descriptionSymbol]!: Description | null;

  constructor(text: unknown = null) {
    this.description = text;
  }

  /**
   * The description for the group.
   *
   * @return {Description|null}
   */
  get description(): Description | null {
    return this[descriptionSymbol] || null;
  }

  /**
   * Set the description on the group.
   *
   * @param {Description|string|null} description
   */
  set description(description: unknown) {
    if (!description && (description !== 0)) {
      this[descriptionSymbol] = null;
    } else if (description instanceof Description) {
      this[descriptionSymbol] = description;
    } else if (typeof description === 'string') {
      this[descriptionSymbol] = new Description(description);
    } else {
      throw new TypeError(`description must be of type Description, string or null. Received ${typeof description}`);
    }
  }

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @returns {{description: (Description|null)}}
   */
  toJSON(): HasDescriptionJSON {
    const { description } = this;

    return {
      description,
    };
  }

  /**
   * Return the String representation of the object.
   *
   * This is called automatically when casting the object to a string.
   *
   * @see {@link RollGroup#notation}
   *
   * @returns {string}
   */
  toString(): string {
    if (this.description) {
      return `${this.description}`;
    }

    return '';
  }
}

export default HasDescription;
