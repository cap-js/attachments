class RequestSend {
  constructor(post) {
    this.post = post
  }
  async draftModeActions(
    serviceName, // e.g., "processor"
    entityName, // e.g., "Incidents"
    id, // entity ID
    action, // the action to execute
    isRootCreated = false
  ) {
    // Use the new separated functions for better maintainability
    const editError = await this.draftModeEdit(
      serviceName,
      entityName,
      id,
      isRootCreated
    )
    if (editError) {
      return editError
    }

    const saveError = await this.draftModeSave(
      serviceName,
      entityName,
      id,
      action
    )
    if (saveError) {
      return saveError
    }
  }

  async draftModeEdit(serviceName, entityName, id) {
    try {
      // Create draft from active entity
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=true)/draftEdit`,
        {
          PreserveChanges: true,
        }
      )
    } catch (err) {
      return err
    }
  }

  async draftModeSave(serviceName, entityName, id, action) {
    try {
      // Execute the action (e.g., POST attachment)
      await action()

      // Prepare the draft
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/draftPrepare`,
        {
          SideEffectsQualifier: "",
        }
      )

      // Activate the draft
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/draftActivate`,
        {}
      )
    } catch (err) {
      return err
    }
  }
}

module.exports = {
  RequestSend,
}
