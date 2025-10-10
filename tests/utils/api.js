class RequestSend {
  constructor(post) {
    this.post = post
  }
  async draftModeEdit(serviceName, entityName, id, path) {
    try {
      // Create draft from active entity
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=true)/${path}.draftEdit`,
        {
          PreserveChanges: true,
        }
      )
    } catch (err) {
      return err
    }
  }

  async draftModeSave(serviceName, entityName, id, action, path) {
    try {
      // Execute the action (e.g., POST attachment)
      await action()

      // Prepare the draft
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftPrepare`,
        {
          SideEffectsQualifier: "",
        }
      )

      // Activate the draft
      await this.post(
        `odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftActivate`,
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
